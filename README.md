# ACP Prime

Gestor de ventas e inventario, multi-empresa. Proyecto independiente de ACP
Core — no reutiliza WordPress/WooCommerce; el backend es 100% Supabase
(Postgres + Auth + Row Level Security) y el frontend es una app estática que
le habla directo desde el navegador. El diseño (colores, tipografía, layout
de cards) reusa los tokens visuales de ACP Core.

Una misma cuenta puede pertenecer a varias empresas (ej. la tienda de ropa
deportiva y la de lazos) y elegir con cuál está trabajando, como cambiar de
"workspace" en Notion/Slack.

## Roles (por empresa, no globales)

Un usuario puede ser `vendedor` en una empresa y `administrador` en otra —
el rol vive en la membresía a esa empresa puntual, no en el usuario.

- **Vendedor**: registra ventas (quedan asociadas a su propio usuario) y ve
  todas las ventas de todos los vendedores de esa empresa.
- **Administrador**: además de lo anterior, crea/edita productos y ajusta
  stock, y ve las ventas agrupadas por vendedor — todo acotado a esa empresa.

La seguridad se aplica a nivel de base de datos (RLS), no solo en pantalla:
ni un bug de la interfaz puede hacer que alguien vea datos de una empresa a
la que no pertenece.

## Poner en marcha la base de datos

1. En el dashboard de Supabase del proyecto, ir a **SQL Editor → New query**.
2. Pegar el contenido completo de [`supabase/schema.sql`](supabase/schema.sql) y ejecutar.
   (Este script borra el esquema de una sola empresa de la primera versión y
   lo reemplaza por el multi-empresa — seguro de correr, no había datos reales.)
3. Crear los usuarios desde **Authentication → Users → Add user** (correo +
   PIN de 6 dígitos como contraseña).
4. Crear la primera empresa y darle acceso a un usuario, corriendo en el SQL Editor:
   ```sql
   -- 1. crear la empresa
   insert into public.organizations (name, slug)
   values ('Ropa Deportiva', 'ropa-deportiva')
   returning id;

   -- 2. con el id que te devolvió arriba, y el uuid del usuario
   --    (se ve en Authentication → Users), darle acceso como administrador
   insert into public.memberships (user_id, organization_id, full_name, role)
   values ('<uuid del usuario>', '<id de la empresa>', 'Nombre del usuario', 'administrador');
   ```
   Repite el paso 4 para cada vendedor (con `role = 'vendedor'`), y para la
   segunda empresa (lazos) cuando llegue el momento — mismo patrón, sin tocar
   nada más.

## Migraciones

`supabase/schema.sql` es el esquema base (ya aplicado). Los cambios
posteriores viven en `supabase/migrations/`, numerados en orden — se corren
una sola vez cada uno, pegándolos en el SQL Editor, sin borrar nada de lo
que ya existe.

- **`001`** (dentro de `schema.sql`): organizaciones, membresías, productos,
  variantes, ventas.
- **`002_costos_y_gastos.sql`**: agrega costo del producto (para calcular
  inversión y ganancia), costo congelado por venta, y una tabla de gastos.
- **`003_registrar_venta.sql`**: función `register_sale()` que crea una
  venta completa y descuenta stock de forma atómica (sin condiciones de
  carrera entre vendedores); amplía a quién puede ver el roster de la empresa.
- **`004_gastos_vendedores.sql`**: permite que cualquier vendedor registre
  gastos (antes era solo lectura/escritura de administrador); administrador
  sigue siendo el único que puede editar o borrar un gasto ya creado.
- **`005_permisos_vendedor.sql`**: agrega `organizations.vendor_permissions`
  (jsonb) para habilitar/deshabilitar, por empresa, si el rol vendedor ve
  Dashboard/Gastos/Productos. Reemplazado por `006` — ver abajo.
- **`006_permisos_por_vendedor.sql`**: mueve ese permiso de la empresa a
  cada vendedor individual (`memberships.vendor_permissions`), porque el
  de `005` afectaba a todos los vendedores de la empresa por igual. Desde
  Configuración → Permisos, el administrador elige un vendedor puntual y
  ve/edita solo sus permisos. El administrador siempre tiene acceso
  completo (no configurable, para no poder auto-bloquearse); y aunque
  Productos esté habilitado, un vendedor solo puede ver el catálogo y
  cargar productos nuevos — nunca editar el stock/precio de uno existente,
  eso queda reservado a administrador sin excepción.
- **`007_margen_sugerido.sql`**: agrega `organizations.suggested_margin_percent`
  (0 a 100, default 30) — el % que se usa para sugerir precio en "Nuevo
  producto" y "Reponer stock" cuando el precio se deja en blanco, editable
  por el administrador desde Configuración → Precios. También repone la
  política de `update` sobre `organizations` que la `006` había quitado
  (ya no hacía falta ahí, pero sí para este campo).
- **`008_stock_minimo.sql`**: agrega `products.low_stock_threshold` (default
  10) — cuántas unidades es "poco" para ese producto en particular, editable
  desde "Nuevo producto"/"Editar producto". El Centro de Recomendaciones del
  Dashboard usa este número (por producto, aplicado a todas sus variantes)
  en vez de un 10 fijo para todos.

## Variables de entorno del frontend

El frontend necesita solo dos datos públicos (no hay backend propio, así que
no hay nada "secreto" que proteger aquí — la seguridad real vive en las
políticas RLS):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (la "publishable key", no la `service_role`)

## Estado

En construcción — ver el historial de commits para el progreso.
