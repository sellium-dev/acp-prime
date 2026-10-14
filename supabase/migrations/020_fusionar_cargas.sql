-- ACP Prime — migración 020: fusionar dos cargas
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Para cuando una misma compra se guardó partida en dos cargas (ej. se
-- eligió "Carga nueva" en vez de sumarla a la que ya existía). Mueve todos
-- los lotes de la carga de origen a la de destino — que conserva su fecha
-- y su número — y elimina la de origen. Todo en una sola operación: o pasa
-- completo o no pasa. No toca stock, ventas ni abonos (las ventas siguen
-- apuntando a los mismos lotes). Reservada a administrador.
create or replace function public.merge_purchases( p_source_id uuid, p_target_id uuid )
returns void
language plpgsql
security definer
as $$
declare
  v_source record;
  v_target record;
begin
  if p_source_id = p_target_id then
    raise exception 'Elige dos cargas distintas';
  end if;

  select * into v_source from public.stock_purchases where id = p_source_id for update;
  select * into v_target from public.stock_purchases where id = p_target_id for update;

  if v_source is null or v_target is null then
    raise exception 'Carga no encontrada';
  end if;
  if v_source.organization_id != v_target.organization_id then
    raise exception 'Las cargas son de empresas distintas';
  end if;
  if not public.is_org_admin( v_source.organization_id ) then
    raise exception 'Solo un administrador puede fusionar cargas';
  end if;

  update public.stock_lots set purchase_id = p_target_id where purchase_id = p_source_id;
  delete from public.stock_purchases where id = p_source_id;
end;
$$;

grant execute on function public.merge_purchases( uuid, uuid ) to authenticated;
