-- ACP Prime — migración 018: pasar una venta a Crédito por error de estado
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Ya existían mark_sale_paid (pre_venta/credito → pagado) y
-- revert_sale_to_pre_venta (pagado → pre_venta), pero no había forma de
-- corregir una venta que se guardó como Pre-venta o como Pagado cuando en
-- realidad era Crédito. Mismo criterio que las otras: cualquier miembro de
-- la empresa puede hacerlo (no solo administrador), no toca stock ni
-- abonos ya cargados, solo el estado.
create or replace function public.mark_sale_credito( p_sale_id uuid )
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
  if v_sale.status not in ( 'pre_venta', 'pagado' ) then
    raise exception 'Esta venta no se puede pasar a crédito desde su estado actual';
  end if;

  update public.sales set status = 'credito' where id = p_sale_id;
end;
$$;

grant execute on function public.mark_sale_credito( uuid ) to authenticated;
