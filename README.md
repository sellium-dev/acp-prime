# ACP Prime

Gestor de ventas e inventario para ropa deportiva. Proyecto independiente de
ACP Core — no reutiliza WordPress/WooCommerce; el backend es 100% Supabase
(Postgres + Auth + Row Level Security) y el frontend es una app estática que
le habla directo desde el navegador. El diseño (colores, tipografía, layout
de cards) reusa los tokens visuales de ACP Core.

## Roles

- **Vendedor**: registra ventas (quedan asociadas a su propio usuario) y ve
  todas las ventas de todos los vendedores.
- **Administrador**: además de lo anterior, crea/edita productos y ajusta
  stock, y ve las ventas agrupadas por vendedor.

La seguridad se aplica a nivel de base de datos (RLS), no solo en pantalla.

## Poner en marcha la base de datos

1. En el dashboard de Supabase del proyecto, ir a **SQL Editor → New query**.
2. Pegar el contenido completo de [`supabase/schema.sql`](supabase/schema.sql) y ejecutar.
3. Crear los usuarios (vendedores + administrador) desde **Authentication → Users → Add user**,
   o dejar que se registren ellos mismos si se habilita signup.
   Cada usuario nuevo recibe automáticamente un perfil con rol `vendedor`.
4. Para promover a alguien a administrador, correr en el SQL Editor:
   ```sql
   update public.profiles set role = 'administrador' where id = '<uuid del usuario>';
   ```
   (el uuid se ve en Authentication → Users).

## Variables de entorno del frontend

El frontend necesita solo dos datos públicos (no hay backend propio, así que
no hay nada "secreto" que proteger aquí — la seguridad real vive en las
políticas RLS):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (la "publishable key", no la `service_role`)

## Estado

En construcción — ver el historial de commits para el progreso.
