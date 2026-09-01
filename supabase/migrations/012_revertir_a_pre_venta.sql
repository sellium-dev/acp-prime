-- ACP Prime — migración 012: revertir una venta Pagado a Pre-venta
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Para el caso de que alguien haya marcado "Pagado" por error. No toca el
-- stock (ya estaba descontado desde que se creó la venta, sigue igual) —
-- solo cambia el estado de vuelta a pendiente de cobro. Cualquier miembro
-- de la empresa puede hacerlo, igual que mark_sale_paid()/void_sale().
create or replace function public.revert_sale_to_pre_venta( p_sale_id uuid )
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
  if v_sale.status != 'pagado' then
    raise exception 'Esta venta no está marcada como pagada';
  end if;

  update public.sales set status = 'pre_venta' where id = p_sale_id;
end;
$$;

grant execute on function public.revert_sale_to_pre_venta( uuid ) to authenticated;
