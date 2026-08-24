-- ACP Prime — migración 004: vendedores pueden registrar gastos
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Antes solo el administrador podía insertar/editar/borrar gastos. Ahora
-- cualquier miembro de la empresa puede REGISTRAR uno (ej. compró algo de
-- su bolsillo para la tienda) — editar y borrar sigue siendo solo admin,
-- para que nadie pueda alterar un gasto ya cargado (ni el suyo propio).
drop policy if exists "expenses_write_org_admin" on public.expenses;

create policy "expenses_insert_member" on public.expenses
  for insert with check (
    public.is_org_member( organization_id ) and created_by = auth.uid()
  );

create policy "expenses_update_org_admin" on public.expenses
  for update using ( public.is_org_admin( organization_id ) );

create policy "expenses_delete_org_admin" on public.expenses
  for delete using ( public.is_org_admin( organization_id ) );
