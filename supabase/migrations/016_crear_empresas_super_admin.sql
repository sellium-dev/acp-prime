-- ACP Prime — migración 016: crear empresas desde la app (solo super admin)
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Hasta ahora crear una empresa se hacía a mano desde el SQL Editor (ver
-- comentario viejo en schema.sql). Esto agrega un rol de "super admin"
-- (el dueño del negocio, no un administrador de una empresa puntual) que
-- puede crear empresas nuevas desde la pantalla de selección de empresa,
-- sin tocar la base de datos cada vez.

-- Quién es super admin sigue siendo algo que se hace a mano (pasa una vez
-- por persona). Después de correr esto, marca tu propio usuario con:
--   insert into public.super_admins (user_id)
--   values ('<tu UID, en Authentication → Users>');

create table public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.super_admins enable row level security;

-- Cada quien solo puede ver si SU PROPIO usuario está en la lista (para que
-- el frontend sepa si debe mostrar el botón "Crear empresa"). Nadie puede
-- leer la lista completa de super admins desde la app.
create policy "super_admins_select_own" on public.super_admins
  for select using ( user_id = auth.uid() );

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.super_admins where user_id = auth.uid()
  );
$$;

-- organizations: además de "solo ves las que son tuyas" (política ya
-- existente), un super admin puede crear filas nuevas. No hay policy de
-- update/delete: renombrar o borrar una empresa se sigue haciendo a mano.
create policy "organizations_insert_super_admin" on public.organizations
  for insert with check ( public.is_super_admin() );

-- memberships: al crear una empresa nueva, quien la crea todavía no es
-- miembro de ella (no puede usar "memberships_write_org_admin", que exige
-- ya ser admin de esa empresa — problema del huevo y la gallina). Esta
-- política deja a un super admin insertarse a SÍ MISMO (user_id = auth.uid())
-- como miembro de cualquier empresa; no le permite agregar a nadie más ni
-- pisar la política existente para administradores normales.
create policy "memberships_insert_super_admin_self" on public.memberships
  for insert with check ( public.is_super_admin() and user_id = auth.uid() );
