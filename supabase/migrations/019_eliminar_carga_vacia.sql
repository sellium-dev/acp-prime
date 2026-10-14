-- ACP Prime — migración 019: eliminar una carga que quedó vacía
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Hasta ahora stock_purchases no tenía forma de borrarse (ni policy de
-- delete). Esta función elimina una carga SOLO si ningún lote de stock la
-- referencia — nunca toca stock, ventas ni abonos. Reservada a
-- administrador, igual que el resto de lo que edita plata/stock ya cargado.
create or replace function public.delete_empty_purchase( p_purchase_id uuid )
returns void
language plpgsql
security definer
as $$
declare
  v_purchase record;
begin
  select * into v_purchase from public.stock_purchases where id = p_purchase_id for update;

  if v_purchase is null then
    raise exception 'Carga no encontrada';
  end if;
  if not public.is_org_admin( v_purchase.organization_id ) then
    raise exception 'Solo un administrador puede eliminar una carga';
  end if;
  if exists ( select 1 from public.stock_lots where purchase_id = p_purchase_id ) then
    raise exception 'La carga tiene stock adentro — no se puede eliminar';
  end if;

  delete from public.stock_purchases where id = p_purchase_id;
end;
$$;

grant execute on function public.delete_empty_purchase( uuid ) to authenticated;
