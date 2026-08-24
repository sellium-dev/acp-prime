-- ACP Prime — migración 003: registrar venta de forma segura + roster visible
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Antes, un vendedor solo veía su propia fila de membresía — no alcanzaba
-- para mostrar "vendido por: fulano" en la lista de ventas de otros
-- vendedores. Se amplía a: cualquier miembro ve el roster completo de su
-- propia empresa (nombre + rol). Seguir sin poder ver otras empresas.
drop policy if exists "memberships_select_own_or_admin" on public.memberships;
create policy "memberships_select_member" on public.memberships
  for select using ( public.is_org_member(organization_id) );

-- Registra una venta completa (cabecera + líneas) y descuenta el stock,
-- todo en una sola transacción atómica. `for update` bloquea la fila de
-- cada variante mientras se procesa, así dos ventas simultáneas de la
-- última unidad no pueden "pisarse" y dejar stock negativo.
create or replace function public.register_sale(
  p_organization_id uuid,
  p_customer_name text,
  p_items jsonb -- [{ "variant_id": "uuid", "quantity": 2 }, ...]
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

  if jsonb_array_length( p_items ) = 0 then
    raise exception 'La venta necesita al menos un producto';
  end if;

  insert into public.sales ( organization_id, vendor_id, customer_name, total_amount )
  values ( p_organization_id, auth.uid(), nullif( p_customer_name, '' ), 0 )
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

grant execute on function public.register_sale( uuid, text, jsonb ) to authenticated;
