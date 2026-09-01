-- ACP Prime — migración 011: fecha de anulación de una venta
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Antes solo quedaba la fecha en que se hizo la venta (created_at). Si una
-- venta de agosto en pre-venta/crédito se anula recién en septiembre, esa
-- anulación debe contar en septiembre, no en agosto — para eso hace falta
-- guardar CUÁNDO se anuló, no solo cuándo se creó la venta.
alter table public.sales
  add column voided_at timestamptz;

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

  update public.sales set status = 'anulado', voided_at = now() where id = p_sale_id;
end;
$$;
