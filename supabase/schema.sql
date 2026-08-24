-- ACP Prime — esquema inicial
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.
-- Seguro de correr una sola vez sobre un proyecto vacío.

-- ============ Tipos ============

create type public.acp_prime_role as enum ('vendedor', 'administrador');

-- ============ Tablas ============

-- Un perfil por usuario autenticado (se crea solo via trigger al registrarse)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.acp_prime_role not null default 'vendedor',
  created_at timestamptz not null default now()
);

-- Producto base (ej. "Polerón DryFit")
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  description text,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Variante concreta (talla + color), con su propio stock y precio
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
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
  vendor_id uuid not null references public.profiles(id),
  customer_name text,
  total_amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

-- Líneas de esa venta (uno o más productos)
create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null -- congelado al momento de la venta
);

create index sales_vendor_id_idx on public.sales(vendor_id);
create index sale_items_sale_id_idx on public.sale_items(sale_id);
create index product_variants_product_id_idx on public.product_variants(product_id);

-- ============ Seguridad (Row Level Security) ============

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

-- Función auxiliar: ¿el usuario actual es administrador?
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'administrador'
  );
$$;

-- profiles: cualquier usuario logueado puede ver todos los perfiles
-- (para mostrar "vendido por Juan" en el listado de ventas)
create policy "profiles_select_authenticated" on public.profiles
  for select using ( auth.role() = 'authenticated' );
create policy "profiles_update_own_or_admin" on public.profiles
  for update using ( id = auth.uid() or public.is_admin() );

-- products / product_variants: lectura para cualquier logueado,
-- escritura (crear/editar/borrar) solo administrador
create policy "products_select_authenticated" on public.products
  for select using ( auth.role() = 'authenticated' );
create policy "products_write_admin" on public.products
  for all using ( public.is_admin() ) with check ( public.is_admin() );

create policy "variants_select_authenticated" on public.product_variants
  for select using ( auth.role() = 'authenticated' );
create policy "variants_write_admin" on public.product_variants
  for all using ( public.is_admin() ) with check ( public.is_admin() );

-- sales: cualquier logueado ve TODAS las ventas (vendedor y admin por igual);
-- crear una venta solo a nombre de uno mismo; editar/borrar solo admin
create policy "sales_select_authenticated" on public.sales
  for select using ( auth.role() = 'authenticated' );
create policy "sales_insert_self" on public.sales
  for insert with check ( vendor_id = auth.uid() );
create policy "sales_update_admin" on public.sales
  for update using ( public.is_admin() );
create policy "sales_delete_admin" on public.sales
  for delete using ( public.is_admin() );

-- sale_items: mismo criterio, ligado a que la venta padre sea propia
create policy "sale_items_select_authenticated" on public.sale_items
  for select using ( auth.role() = 'authenticated' );
create policy "sale_items_insert_own_sale" on public.sale_items
  for insert with check (
    exists ( select 1 from public.sales s where s.id = sale_id and s.vendor_id = auth.uid() )
  );
create policy "sale_items_admin_update" on public.sale_items
  for update using ( public.is_admin() );
create policy "sale_items_admin_delete" on public.sale_items
  for delete using ( public.is_admin() );

-- ============ Auto-creación de perfil al registrarse ============

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'vendedor'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
