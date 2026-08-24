-- ACP Prime — migración 006: permisos de vendedor por persona, no por empresa
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.
-- Requiere haber corrido antes 005_permisos_vendedor.sql.

-- El toggle de 005 vivía en la empresa (organizations.vendor_permissions),
-- así que afectaba a TODOS los vendedores de esa empresa por igual. Ahora
-- cada vendedor tiene su propio permiso, en su fila de membresía.
alter table public.memberships
  add column vendor_permissions jsonb not null default '{"dashboard": true, "gastos": true, "productos": false}'::jsonb;

-- Copia lo que ya tenía configurado la empresa a cada vendedor existente,
-- para no perder lo que se haya cambiado desde que se corrió 005.
update public.memberships m
set vendor_permissions = o.vendor_permissions
from public.organizations o
where m.organization_id = o.id and m.role = 'vendedor';

-- org_allows_vendor() leía el permiso de la empresa; se reemplaza por una
-- función que lee el permiso de la membresía de quien está llamando.
-- security definer porque quien llama puede ser un vendedor sin permiso
-- de leer memberships de otra persona (igual solo lee un booleano propio).
drop function if exists public.org_allows_vendor( uuid, text );

create or replace function public.member_allows_vendor( org_id uuid, module text )
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    ( select ( vendor_permissions ->> module )::boolean
      from public.memberships
      where organization_id = org_id and user_id = auth.uid() ),
    false
  );
$$;

-- Productos / variantes: mismo criterio de 005 (insert = admin o vendedor
-- habilitado; update/delete = siempre solo admin), ahora consultando el
-- permiso de la persona en vez del de la empresa.
drop policy if exists "products_insert_admin_or_enabled_vendor" on public.products;
create policy "products_insert_admin_or_enabled_vendor" on public.products
  for insert with check (
    public.is_org_admin( organization_id )
    or ( public.is_org_member( organization_id ) and public.member_allows_vendor( organization_id, 'productos' ) )
  );

drop policy if exists "variants_insert_admin_or_enabled_vendor" on public.product_variants;
create policy "variants_insert_admin_or_enabled_vendor" on public.product_variants
  for insert with check (
    public.is_org_admin( organization_id )
    or ( public.is_org_member( organization_id ) and public.member_allows_vendor( organization_id, 'productos' ) )
  );

-- El toggle ya no vive en la empresa. Actualizar memberships.vendor_permissions
-- ya lo permite la política existente "memberships_write_org_admin" (el
-- administrador puede editar cualquier membresía de su empresa), así que no
-- hace falta ninguna política nueva para esto.
alter table public.organizations drop column if exists vendor_permissions;
drop policy if exists "organizations_update_org_admin" on public.organizations;
