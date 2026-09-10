-- ACP Prime — migración 015: corrige la fecha del "Lote 1" (28 de octubre
-- era un error de mes, no la fecha real). Pega este archivo completo en
-- Supabase → SQL Editor → New query → Run.

-- La migración 013 fechó el "Lote 1" (todo el stock que ya existía antes de
-- tener lotes) al "viernes 28 de octubre 19:00 hora Chile" — pero el 28 de
-- octubre de 2026 cae miércoles, no viernes. El 28 de agosto de 2026 sí cae
-- viernes, así que el mes correcto era agosto, no octubre — se escribió mal
-- al redactar la migración. Esto corrige tanto la carga (stock_purchases,
-- creada por la migración 014 al agrupar por fecha exacta) como los lotes
-- (stock_lots) que quedaron con esa fecha, en todas las empresas afectadas.
update public.stock_purchases
set created_at = '2026-08-28 19:00:00'::timestamp at time zone 'America/Santiago'
where created_at = '2026-10-28 19:00:00'::timestamp at time zone 'America/Santiago';

update public.stock_lots
set created_at = '2026-08-28 19:00:00'::timestamp at time zone 'America/Santiago'
where created_at = '2026-10-28 19:00:00'::timestamp at time zone 'America/Santiago';
