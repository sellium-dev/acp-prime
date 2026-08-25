-- ACP Prime — migración 008: stock mínimo configurable por producto
-- Pega este archivo completo en Supabase → SQL Editor → New query → Run.

-- Antes el aviso de "stock crítico" del Centro de Recomendaciones usaba
-- un número fijo (10 unidades) para todos los productos por igual. Ahora
-- cada producto tiene el suyo, editable desde "Nuevo producto"/"Editar
-- producto" (aplica a todas sus variantes/tallas por igual).
alter table public.products
  add column low_stock_threshold integer not null default 1
  check ( low_stock_threshold >= 0 );
