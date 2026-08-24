-- ACP Prime — esquema multi-tienda
-- Reemplaza por completo el esquema anterior (de un solo negocio).
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.
-- Seguro de correr sobre el proyecto tal como quedó después del primer script
-- (no había datos reales cargados todavía).

-- ============ Limpieza del esquema anterior ============

drop table if exists public.sale_items cascade;
drop table if exists public.sales cascade;
drop table if exists public.product_variants cascade;
drop table if exists public.products cascade;
drop table if exists public.profiles cascade;
drop function if exists public.handle_new_user cascade;
drop function if exists public.is_admin cascade;

-- ============ Tipos ============
-- (se reusa si ya existe del script anterior)

do $$ begin
  create type public.acp_prime_role as enum ('vendedor', 'administrador');
exception when duplicate_object then null;
end $$;

-- ============ Tablas ============

-- Una empresa/negocio (ej. "Tik Shopper Ropa Deportiva", "Lazos de la Suegra")
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Conecta usuario ↔ empresa ↔ rol. Un mismo usuario puede tener una fila
-- por cada empresa a la que pertenece, con rol independiente en cada una.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  role public.acp_prime_role not null default 'vendedor',
  created_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

-- Producto base, siempre ligado a una empresa
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text not null,
  description text,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Variante concreta (talla + color), con su propio stock y precio.
-- organization_id se repite aquí a propósito (evita joins en cada regla de
-- seguridad y hace las políticas más simples y rápidas).
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  size text not null,
  color text,
  sku text,
  price numeric(10, 2) not null,
  stock_quantity integer not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, size, color)
);

-- Cabecera de una venta
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references auth.users(id),
  customer_name text,
  total_amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

-- Líneas de esa venta (uno o más productos)
create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null -- congelado al momento de la venta
);

create index memberships_user_id_idx on public.memberships(user_id);
create index memberships_org_id_idx on public.memberships(organization_id);
create index products_org_id_idx on public.products(organization_id);
create index product_variants_product_id_idx on public.product_variants(product_id);
create index product_variants_org_id_idx on public.product_variants(organization_id);
create index sales_org_id_idx on public.sales(organization_id);
create index sales_vendor_id_idx on public.sales(vendor_id);
create index sale_items_sale_id_idx on public.sale_items(sale_id);
create index sale_items_org_id_idx on public.sale_items(organization_id);

-- ============ Seguridad (Row Level Security) ============

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

-- ¿El usuario actual pertenece a esta empresa (cualquier rol)?
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id and user_id = auth.uid()
  );
$$;

-- ¿El usuario actual es administrador de esta empresa?
create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id and user_id = auth.uid() and role = 'administrador'
  );
$$;

-- organizations: solo ves las empresas a las que perteneces.
-- Crear una empresa nueva se hace a mano desde el SQL Editor (es algo que
-- pasa una o dos veces al año, no necesita pantalla propia por ahora).
create policy "organizations_select_member" on public.organizations
  for select using ( public.is_org_member(id) );

-- memberships: ves tus propias membresías (para saber a qué empresas
-- perteneces) y, si eres admin de una empresa, ves quién más pertenece a ella.
create policy "memberships_select_own_or_admin" on public.memberships
  for select using ( user_id = auth.uid() or public.is_org_admin(organization_id) );
create policy "memberships_write_org_admin" on public.memberships
  for all using ( public.is_org_admin(organization_id) ) with check ( public.is_org_admin(organization_id) );

-- products / product_variants: lectura para cualquier miembro de la empresa,
-- escritura (crear/editar/borrar) solo administrador de esa empresa
create policy "products_select_member" on public.products
  for select using ( public.is_org_member(organization_id) );
create policy "products_write_org_admin" on public.products
  for all using ( public.is_org_admin(organization_id) ) with check ( public.is_org_admin(organization_id) );

create policy "variants_select_member" on public.product_variants
  for select using ( public.is_org_member(organization_id) );
create policy "variants_write_org_admin" on public.product_variants
  for all using ( public.is_org_admin(organization_id) ) with check ( public.is_org_admin(organization_id) );

-- sales: cualquier miembro de la empresa ve TODAS las ventas de esa empresa
-- (vendedor y admin por igual); crear una venta solo a nombre de uno mismo;
-- editar/borrar solo admin de esa empresa
create policy "sales_select_member" on public.sales
  for select using ( public.is_org_member(organization_id) );
create policy "sales_insert_self" on public.sales
  for insert with check ( vendor_id = auth.uid() and public.is_org_member(organization_id) );
create policy "sales_update_org_admin" on public.sales
  for update using ( public.is_org_admin(organization_id) );
create policy "sales_delete_org_admin" on public.sales
  for delete using ( public.is_org_admin(organization_id) );

-- sale_items: mismo criterio, ligado a que la venta padre sea propia
create policy "sale_items_select_member" on public.sale_items
  for select using ( public.is_org_member(organization_id) );
create policy "sale_items_insert_own_sale" on public.sale_items
  for insert with check (
    public.is_org_member(organization_id)
    and exists ( select 1 from public.sales s where s.id = sale_id and s.vendor_id = auth.uid() )
  );
create policy "sale_items_update_org_admin" on public.sale_items
  for update using ( public.is_org_admin(organization_id) );
create policy "sale_items_delete_org_admin" on public.sale_items
  for delete using ( public.is_org_admin(organization_id) );
