-- ACP Prime — migración 005: permisos de vendedor configurables por empresa
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Qué módulos opcionales puede ver/usar el rol vendedor, por empresa.
-- El administrador siempre tiene todo — esto nunca lo restringe a él,
-- para que jamás se pueda quedar sin acceso a su propia cuenta por error.
alter table public.organizations
  add column vendor_permissions jsonb not null default '{"dashboard": true, "gastos": true, "productos": false}'::jsonb;

-- Antes no existía ninguna política de escritura sobre organizations —
-- el administrador no podía cambiar ni siquiera esto. Se agrega, acotada
-- a la propia empresa.
create policy "organizations_update_org_admin" on public.organizations
  for update using ( public.is_org_admin( id ) ) with check ( public.is_org_admin( id ) );

-- Lee vendor_permissions de la empresa y devuelve si ese módulo está
-- habilitado para vendedores. security definer porque el que llama esto
-- puede ser un vendedor sin permiso de ver la fila completa de otro modo
-- (igual solo lee un booleano, no expone nada sensible).
create or replace function public.org_allows_vendor( org_id uuid, module text )
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    ( select ( vendor_permissions ->> module )::boolean from public.organizations where id = org_id ),
    false
  );
$$;

-- Productos: se separa el "for all" de antes en insert (admin, o vendedor
-- si su empresa lo habilitó) y update/delete (siempre solo administrador
-- — así un vendedor puede cargar un producto nuevo pero nunca tocar el
-- stock/precio de uno que ya existe).
drop policy if exists "products_write_org_admin" on public.products;

create policy "products_insert_admin_or_enabled_vendor" on public.products
  for insert with check (
    public.is_org_admin( organization_id )
    or ( public.is_org_member( organization_id ) and public.org_allows_vendor( organization_id, 'productos' ) )
  );
create policy "products_update_org_admin" on public.products
  for update using ( public.is_org_admin( organization_id ) );
create policy "products_delete_org_admin" on public.products
  for delete using ( public.is_org_admin( organization_id ) );

-- Mismo criterio para las variantes (talla/color/costo/precio/stock).
drop policy if exists "variants_write_org_admin" on public.product_variants;

create policy "variants_insert_admin_or_enabled_vendor" on public.product_variants
  for insert with check (
    public.is_org_admin( organization_id )
    or ( public.is_org_member( organization_id ) and public.org_allows_vendor( organization_id, 'productos' ) )
  );
create policy "variants_update_org_admin" on public.product_variants
  for update using ( public.is_org_admin( organization_id ) );
create policy "variants_delete_org_admin" on public.product_variants
  for delete using ( public.is_org_admin( organization_id ) );
