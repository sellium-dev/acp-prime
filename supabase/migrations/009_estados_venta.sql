-- ACP Prime — migración 009: estado de venta (Pre-venta / Crédito / Pagado / Anulado)
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

alter table public.sales
  add column status text not null default 'pagado'
  check ( status in ('pre_venta', 'credito', 'pagado', 'anulado') );

-- register_sale() ahora recibe el estado inicial de la venta (por defecto
-- 'pagado', igual que se comportaba antes de esta migración). El stock se
-- descuenta SIEMPRE al crear la venta, sin importar el estado — pre-venta
-- y crédito también reservan stock, para no vender dos veces la misma
-- última unidad mientras está pendiente de cobro.
create or replace function public.register_sale(
  p_organization_id uuid,
  p_customer_name text,
  p_items jsonb, -- [{ "variant_id": "uuid", "quantity": 2 }, ...]
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
  v_qty integer;
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

    insert into public.sale_items ( sale_id, organization_id, product_variant_id, quantity, unit_price, unit_cost )
    values ( v_sale_id, p_organization_id, v_variant.id, v_qty, v_variant.price, v_variant.cost );

    update public.product_variants
      set stock_quantity = stock_quantity - v_qty
      where id = v_variant.id;

    v_total := v_total + ( v_variant.price * v_qty );
  end loop;

  update public.sales set total_amount = v_total where id = v_sale_id;

  return v_sale_id;
end;
$$;

-- Supabase no reemplaza la función vieja de 3 argumentos sola con un
-- create-or-replace de 4 argumentos (quedan las dos firmas coexistiendo) —
-- se borra explícitamente la anterior para no dejar la de 3 argumentos
-- huérfana apuntando a la versión vieja sin estado.
drop function if exists public.register_sale( uuid, text, jsonb );

grant execute on function public.register_sale( uuid, text, jsonb, text ) to authenticated;

-- Marca una venta en Pre-venta/Crédito como Pagado. No toca el stock (ya
-- se descontó al crearla) — solo cambia el estado. Cualquier miembro de
-- la empresa puede hacerlo, no solo administrador.
create or replace function public.mark_sale_paid( p_sale_id uuid )
returns void
language plpgsql
security definer
as $$
declare
  v_sale record;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;

  if v_sale is null then
    raise exception 'Venta no encontrada';
  end if;
  if not public.is_org_member( v_sale.organization_id ) then
    raise exception 'No perteneces a esta empresa';
  end if;
  if v_sale.status not in ( 'pre_venta', 'credito' ) then
    raise exception 'Esta venta no está pendiente de cobro';
  end if;

  update public.sales set status = 'pagado' where id = p_sale_id;
end;
$$;

grant execute on function public.mark_sale_paid( uuid ) to authenticated;

-- Anula una venta: devuelve el stock de cada línea a product_variants y
-- marca la venta como 'anulado' — el registro NUNCA se borra, solo cambia
-- de estado (queda visible en la tabla de Ventas con esa etiqueta).
-- Cualquier miembro de la empresa puede anular, no solo administrador.
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
  end loop;

  update public.sales set status = 'anulado' where id = p_sale_id;
end;
$$;

grant execute on function public.void_sale( uuid ) to authenticated;
