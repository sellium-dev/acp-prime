-- ACP Prime — migración 002: costos y gastos
-- A diferencia de supabase/schema.sql (el esquema base ya aplicado), esto
-- se suma sin borrar nada — ya hay una empresa y una membresía reales.
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Costo del producto (para calcular inversión y ganancia potencial)
alter table public.product_variants
  add column cost numeric(10, 2) not null default 0;

-- Costo congelado al momento de la venta — igual que unit_price, así si el
-- costo del producto cambia después, las ventas viejas no se alteran.
alter table public.sale_items
  add column unit_cost numeric(10, 2) not null default 0;

-- Gastos del negocio (publicidad, arriendo, etc.)
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  description text not null,
  amount numeric(10, 2) not null,
  category text,
  expense_date date not null default current_date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index expenses_org_id_idx on public.expenses(organization_id);
create index expenses_date_idx on public.expenses(expense_date);

alter table public.expenses enable row level security;

-- lectura: cualquier miembro de la empresa (para que el Dashboard cuadre
-- igual sea vendedor o admin quien lo mire)
create policy "expenses_select_member" on public.expenses
  for select using ( public.is_org_member(organization_id) );

-- escritura: solo administrador — los gastos afectan la ganancia neta que
-- ve el dueño del negocio, no es algo que cualquier vendedor deba tocar
create policy "expenses_write_org_admin" on public.expenses
  for all using ( public.is_org_admin(organization_id) ) with check ( public.is_org_admin(organization_id) );
