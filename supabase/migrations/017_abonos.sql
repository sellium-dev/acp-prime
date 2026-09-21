-- ACP Prime — migración 017: abonos (pagos parciales) sobre una venta
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Antes una venta en Pre-venta/Crédito solo podía pasar de golpe a Pagado
-- (mark_sale_paid) o quedarse pendiente por el total completo. Ahora se le
-- pueden ir registrando abonos parciales (ej. vendiste $20.000 y te pagan
-- $10.000 hoy) sin perder de vista cuánto queda pendiente. El total de la
-- venta (sales.total_amount) no cambia — lo que cambia es cuánto de ese
-- total ya se cobró.

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references auth.users(id),
  amount numeric(10, 2) not null check ( amount > 0 ),
  created_at timestamptz not null default now()
);

create index sale_payments_sale_id_idx on public.sale_payments(sale_id);
create index sale_payments_org_id_idx on public.sale_payments(organization_id);

alter table public.sale_payments enable row level security;

-- Lectura para cualquier miembro de la empresa (igual que sales/sale_items).
-- No hay policy de insert/update directa: todo pasa por las funciones de
-- abajo, que validan estado de la venta y recalculan el saldo.
create policy "sale_payments_select_member" on public.sale_payments
  for select using ( public.is_org_member(organization_id) );

-- Registra un abono nuevo. Cualquier miembro de la empresa puede hacerlo
-- (mismo criterio que mark_sale_paid/void_sale). Si el abono completa el
-- saldo, la venta pasa sola a 'pagado' — mismo efecto que "Marcar pagado"
-- pero disparado por juntar el 100%, no por un click aparte.
create or replace function public.register_sale_payment( p_sale_id uuid, p_amount numeric )
returns void
language plpgsql
security definer
as $$
declare
  v_sale record;
  v_paid numeric(10, 2);
begin
  select * into v_sale from public.sales where id = p_sale_id for update;

  if v_sale is null then
    raise exception 'Venta no encontrada';
  end if;
  if not public.is_org_member( v_sale.organization_id ) then
    raise exception 'No perteneces a esta empresa';
  end if;
  if v_sale.status not in ( 'pre_venta', 'credito' ) then
    raise exception 'Esta venta no está pendiente de cobro';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El abono debe ser mayor a cero';
  end if;

  select coalesce( sum( amount ), 0 ) into v_paid
    from public.sale_payments where sale_id = p_sale_id;

  if p_amount > ( v_sale.total_amount - v_paid ) then
    raise exception 'El abono no puede ser mayor al saldo pendiente (%)', ( v_sale.total_amount - v_paid );
  end if;

  insert into public.sale_payments ( sale_id, organization_id, vendor_id, amount )
  values ( p_sale_id, v_sale.organization_id, auth.uid(), p_amount );

  if v_paid + p_amount >= v_sale.total_amount then
    update public.sales set status = 'pagado' where id = p_sale_id;
  end if;
end;
$$;

grant execute on function public.register_sale_payment( uuid, numeric ) to authenticated;

-- Corrige un abono ya cargado (ej. se apretó mal el monto). Reservado a
-- administrador, igual que "Editar venta" — es plata ya contabilizada, no
-- un simple estado. Si la corrección hace que el total abonado deje de
-- alcanzar el 100%, la venta que había quedado 'pagado' por abonos vuelve
-- a 'credito' (queda pendiente de nuevo); si la corrección la completa,
-- pasa a 'pagado'. No toca ventas anuladas.
create or replace function public.update_sale_payment( p_payment_id uuid, p_amount numeric )
returns void
language plpgsql
security definer
as $$
declare
  v_payment record;
  v_sale record;
  v_other_paid numeric(10, 2);
begin
  select * into v_payment from public.sale_payments where id = p_payment_id for update;
  if v_payment is null then
    raise exception 'Abono no encontrado';
  end if;

  select * into v_sale from public.sales where id = v_payment.sale_id for update;
  if v_sale is null then
    raise exception 'Venta no encontrada';
  end if;
  if not public.is_org_admin( v_sale.organization_id ) then
    raise exception 'Solo un administrador puede editar un abono';
  end if;
  if v_sale.status = 'anulado' then
    raise exception 'No se puede editar un abono de una venta anulada';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El abono debe ser mayor a cero';
  end if;

  select coalesce( sum( amount ), 0 ) into v_other_paid
    from public.sale_payments
    where sale_id = v_sale.id and id != p_payment_id;

  if p_amount > ( v_sale.total_amount - v_other_paid ) then
    raise exception 'El abono no puede superar el total de la venta (saldo disponible: %)', ( v_sale.total_amount - v_other_paid );
  end if;

  update public.sale_payments set amount = p_amount where id = p_payment_id;

  if ( v_other_paid + p_amount ) >= v_sale.total_amount then
    if v_sale.status != 'pagado' then
      update public.sales set status = 'pagado' where id = v_sale.id;
    end if;
  else
    if v_sale.status = 'pagado' then
      update public.sales set status = 'credito' where id = v_sale.id;
    end if;
  end if;
end;
$$;

grant execute on function public.update_sale_payment( uuid, numeric ) to authenticated;
