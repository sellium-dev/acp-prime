-- ACP Prime — migración 007: % de ganancia sugerido, configurable por empresa
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Antes el 30% estaba fijo en el código. Ahora cada empresa puede poner
-- el suyo (0 a 100) desde Configuración, y se usa para calcular el
-- precio/costo sugerido en "Nuevo producto" y "Reponer stock".
alter table public.organizations
  add column suggested_margin_percent integer not null default 30
  check ( suggested_margin_percent between 0 and 100 );

-- La 006 había quitado esta política porque ya no hacía falta (el
-- permiso de vendedor se movió a memberships) — se vuelve a necesitar
-- acá para que el administrador pueda cambiar este número.
create policy "organizations_update_org_admin" on public.organizations
  for update using ( public.is_org_admin( id ) ) with check ( public.is_org_admin( id ) );
