-- ACP Prime — migración 010: precio editable por línea al registrar una venta
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- register_sale() aceptaba solo variant_id + quantity por línea y siempre
-- usaba el precio de catálogo. Ahora cada línea puede traer su propio
-- "unit_price" (ej. para un descuento puntual al cliente) — si no viene,
-- sigue usando el precio de catálogo como antes. El costo (unit_cost)
-- siempre es el de catálogo, así que si el precio manual queda por debajo
-- del costo, la utilidad de esa línea da negativa — es a propósito, para
-- que se refleje de verdad en "Ganancia" del Dashboard.
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
  v_qty integer;
  v_unit_price numeric(10, 2);
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

    insert into public.sale_items ( sale_id, organization_id, product_variant_id, quantity, unit_price, unit_cost )
    values ( v_sale_id, p_organization_id, v_variant.id, v_qty, v_unit_price, v_variant.cost );

    update public.product_variants
      set stock_quantity = stock_quantity - v_qty
      where id = v_variant.id;

    v_total := v_total + ( v_unit_price * v_qty );
  end loop;

  update public.sales set total_amount = v_total where id = v_sale_id;

  return v_sale_id;
end;
$$;
