-- ACP Prime — migración 014: agrupar los lotes de stock en "cargas" (compras)
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Hasta ahora cada lote (stock_lots) era una fila suelta por variante, sin
-- forma de saber que 5 filas distintas venían de la MISMA compra. Esta tabla
-- agrupa eso: una carga = una compra, que puede traer varios productos/tallas
-- a la vez.
create table public.stock_purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index stock_purchases_org_id_idx on public.stock_purchases(organization_id);

alter table public.stock_purchases enable row level security;

create policy "stock_purchases_select_member" on public.stock_purchases
  for select using ( public.is_org_member( organization_id ) );
create policy "stock_purchases_insert_admin_or_enabled_vendor" on public.stock_purchases
  for insert with check (
    public.is_org_admin( organization_id )
    or ( public.is_org_member( organization_id ) and public.member_allows_vendor( organization_id, 'productos' ) )
  );

alter table public.stock_lots
  add column purchase_id uuid references public.stock_purchases(id);

-- Backfill: los lotes que ya existen se agrupan por su fecha exacta. El
-- "Lote 1" base quedó todo fechado igual (28 de octubre), así que cae en una
-- sola carga. Cada reposición hecha antes de esta migración, al tener su
-- propio momento exacto, queda como su propia carga de un solo ítem — no hay
-- forma de saber retroactivamente cuáles se guardaron "juntas" en un mismo
-- clic, así que se agrupa por lo único verificable: la fecha.
insert into public.stock_purchases ( organization_id, created_at )
select distinct organization_id, created_at from public.stock_lots;

update public.stock_lots sl
set purchase_id = sp.id
from public.stock_purchases sp
where sp.organization_id = sl.organization_id and sp.created_at = sl.created_at;
