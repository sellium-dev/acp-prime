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

## Variables de entorno del frontend

El frontend necesita solo dos datos públicos (no hay backend propio, así que
no hay nada "secreto" que proteger aquí — la seguridad real vive en las
políticas RLS):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (la "publishable key", no la `service_role`)

## Estado

En construcción — ver el historial de commits para el progreso.
