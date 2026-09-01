-- ACP Prime — migración 013: lotes de stock (FIFO) para saber qué se ha
-- recuperado de cada compra/reposición
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Cada vez que entra stock (producto nuevo o reposición) queda como un
-- "lote" con su propia fecha y costo — así se puede saber, por ejemplo,
-- cuánto se invirtió en octubre y cuánto de ESO se ha vendido desde
-- entonces, sin importar que el producto ya tuviera stock viejo antes.
create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  quantity integer not null check (quantity > 0), -- cantidad original comprada en este lote
  remaining_quantity integer not null check (remaining_quantity >= 0),
  unit_cost numeric(10, 2) not null,
  created_at timestamptz not null default now()
);

create index stock_lots_variant_id_idx on public.stock_lots(product_variant_id);
create index stock_lots_org_id_idx on public.stock_lots(organization_id);

alter table public.stock_lots enable row level security;

create policy "stock_lots_select_member" on public.stock_lots
  for select using ( public.is_org_member( organization_id ) );
create policy "stock_lots_insert_admin_or_enabled_vendor" on public.stock_lots
  for insert with check (
    public.is_org_admin( organization_id )
    or ( public.is_org_member( organization_id ) and public.member_allows_vendor( organization_id, 'productos' ) )
  );
create policy "stock_lots_update_org_admin" on public.stock_lots
  for update using ( public.is_org_admin( organization_id ) );

-- Qué lote(s) surtieron cada línea de venta — necesario para devolver la
-- unidad exacta a su lote si la venta se anula. Nullable porque las
-- ventas de antes de esta migración no tienen lote asociado.
alter table public.sale_items
  add column stock_lot_id uuid references public.stock_lots(id);

-- Todo el stock actual se agrupa en un único lote base ("Lote 1"), fechado
-- al viernes 28 de octubre 19:00 hora Chile (fecha real de esa compra).
insert into public.stock_lots ( organization_id, product_variant_id, quantity, remaining_quantity, unit_cost, created_at )
select organization_id, id, stock_quantity, stock_quantity, cost,
  '2026-10-28 19:00:00'::timestamp at time zone 'America/Santiago'
from public.product_variants
where stock_quantity > 0;

-- register_sale(): ahora consume el stock lote por lote, del más antiguo
-- al más nuevo (FIFO) — si una venta cruza dos lotes con costos distintos,
-- queda repartida en dos filas de sale_items, cada una con el costo real
-- del lote de donde salió.
create or replace function public.register_sale(
  p_organization_id uuid,
  p_customer_name text,
  p_items jsonb, -- [{ "variant_id": "uuid", "quantity": 2, "unit_price": 5500 }, ...]
  p_status text default 'pagado'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_variant record;
  v_lot record;
  v_qty integer;
  v_unit_price numeric(10, 2);
  v_remaining integer;
  v_take integer;
  v_total numeric(10, 2) := 0;
begin
  if not public.is_org_member( p_organization_id ) then
    raise exception 'No perteneces a esta empresa';
  end if;

  if p_status not in ( 'pre_venta', 'credito', 'pagado' ) then
    raise exception 'Estado inválido para una venta nueva';
  end if;

  if jsonb_array_length( p_items ) = 0 then
    raise exception 'La venta necesita al menos un producto';
  end if;

  insert into public.sales ( organization_id, vendor_id, customer_name, total_amount, status )
  values ( p_organization_id, auth.uid(), nullif( p_customer_name, '' ), 0, p_status )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements( p_items )
  loop
    v_qty := ( v_item ->> 'quantity' )::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Cantidad inválida';
    end if;

    select * into v_variant
      from public.product_variants
      where id = ( v_item ->> 'variant_id' )::uuid
        and organization_id = p_organization_id
      for update;

    if v_variant is null then
      raise exception 'Producto no encontrado en esta empresa';
    end if;

    if v_variant.stock_quantity < v_qty then
      raise exception 'Stock insuficiente (% % disponibles)', v_variant.stock_quantity, v_variant.size;
    end if;

    v_unit_price := ( v_item ->> 'unit_price' )::numeric;
    if v_unit_price is null or v_unit_price < 0 then
      v_unit_price := v_variant.price;
    end if;

    v_remaining := v_qty;

    for v_lot in
      select * from public.stock_lots
      where product_variant_id = v_variant.id and remaining_quantity > 0
      order by created_at asc
      for update
    loop
      exit when v_remaining <= 0;

      v_take := least( v_remaining, v_lot.remaining_quantity );

      insert into public.sale_items ( sale_id, organization_id, product_variant_id, quantity, unit_price, unit_cost, stock_lot_id )
      values ( v_sale_id, p_organization_id, v_variant.id, v_take, v_unit_price, v_lot.unit_cost, v_lot.id );

      update public.stock_lots set remaining_quantity = remaining_quantity - v_take where id = v_lot.id;

      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      -- No debería pasar si stock_quantity está sincronizado con la suma
      -- de los lotes, pero se corta acá en vez de vender unidades "sin
      -- lote" (dejaría esa parte de la venta sin costo real detrás).
      raise exception 'Stock insuficiente en los lotes registrados para %', v_variant.size;
    end if;

    update public.product_variants
      set stock_quantity = stock_quantity - v_qty
      where id = v_variant.id;

    v_total := v_total + ( v_unit_price * v_qty );
  end loop;

  update public.sales set total_amount = v_total where id = v_sale_id;

  return v_sale_id;
end;
$$;

-- void_sale(): devuelve cada línea a su lote de origen exacto (no solo al
-- total del producto), para que el % recuperado de ese lote quede bien.
create or replace function public.void_sale( p_sale_id uuid )
returns void
language plpgsql
security definer
as $$
declare
  v_sale record;
  v_item record;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;

  if v_sale is null then
    raise exception 'Venta no encontrada';
  end if;
  if not public.is_org_member( v_sale.organization_id ) then
    raise exception 'No perteneces a esta empresa';
  end if;
  if v_sale.status = 'anulado' then
    raise exception 'Esta venta ya está anulada';
  end if;

  for v_item in select * from public.sale_items where sale_id = p_sale_id
  loop
    update public.product_variants
      set stock_quantity = stock_quantity + v_item.quantity
      where id = v_item.product_variant_id;

    if v_item.stock_lot_id is not null then
      update public.stock_lots
        set remaining_quantity = remaining_quantity + v_item.quantity
        where id = v_item.stock_lot_id;
    end if;
  end loop;

  update public.sales set status = 'anulado', voided_at = now() where id = p_sale_id;
end;
$$;
