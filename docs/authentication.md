# Autenticación SSO de SIREFO

## Arquitectura

SIAU (Identity Hub) es el único proveedor de autenticación; los roles se administran en SIREFO.
El backend implementa OIDC Authorization Code + PKCE S256 con `scope=openid`.
`jose` valida firma RS256, `kid` contra JWKS, `iss`, `aud`, `iat` y `exp`; `SiauService` comprueba `nonce` e identidad (`sub`, `externalKey`, `name`, `sid`).
El ID Token se usa solo en el callback; no se persiste ni se entrega a Angular. El access token no sostiene la sesión y no hay refresh token.

## Flujo de acceso

1. El guard de rutas protegidas consulta `GET /api/auth/me`. Ante `401`, Angular navega automáticamente al backend `GET /auth/login`.
   Angular utiliza el origen de su API; no construye la URL de autorización de SIAU.
2. `/auth/login` guarda una transacción de cinco minutos con `state` hasheado, `nonce` y verificador PKCE.
   La cookie opaca `sirefo_oauth_transaction` (`HttpOnly`, `Path=/auth`) vincula el intento al navegador; el backend redirige a SIAU.
3. `GET /auth/callback` consume la transacción atómicamente, comprueba `state` y vencimiento, y canjea el código mediante HTTP Basic y PKCE.
   Después valida el ID Token, resuelve el usuario local y crea la sesión.
4. El callback reemplaza la sesión anterior, establece la cookie y redirige a `/` del frontend configurado.

`/login?error=…` muestra errores OIDC y permite reintentar manualmente; `/login` tampoco inicia SSO sin parámetros.
Si ya hay sesión válida y no hay parámetro `error`, su guard redirige a `/`.
Errores de red, `5xx` y `403` al consultar la sesión llevan a `/login` sin iniciar SSO; el logout voluntario también termina allí.
Un `401` de otras peticiones de la API limpia el contexto y lleva a `/login` para reintento manual.

## Sesiones y cierre de sesión

- `sirefo_session` contiene un identificador aleatorio opaco: `HttpOnly`, `Path=/`, `SameSite=Lax`; `Secure` en HTTPS o producción.
- `AuthSession` guarda `userId`, `siauSid` y expiración absoluta: **10 horas por defecto**, configurables con `SESSION_TTL_SECONDS`.
- La actividad actualiza `lastUsedAt`, sin extender el vencimiento. Las peticiones normales validan la sesión local, sin consultar SIAU.
- `GET /api/auth/me` devuelve usuario, roles y menú actuales; el guard global rechaza sesiones ausentes, vencidas o revocadas.
- `POST /api/auth/logout` elimina la sesión y limpia ambas cookies, incluso sin sesión válida.
  Después del borrado local, notifica en segundo plano a SIAU mediante `POST /internal/sessions/logout` con `sid` y HTTP Basic; un fallo remoto no revierte el cierre.
- Angular limpia su contexto, navega a `/login` y sincroniza el cierre entre pestañas mediante `BroadcastChannel('sirefo-auth')`.
- `POST /api/auth/backchannel-logout` recibe `logout_token` como formulario, sin depender de cookies.
  Valida firma, emisor, audiencia, tiempos, `typ=logout+jwt`, `jti`, `sid`, evento estándar de logout y ausencia de `nonce`.
  Elimina idempotentemente todas las sesiones con ese `siauSid`; la revocación se detecta en la siguiente petición autenticada.

## Usuarios y autorización

- `User.externalKey` es nullable y único: los históricos pueden permanecer sin vincular; toda alta nueva exige una clave SIAU válida.
- JIT busca por `externalKey`; si no existe, crea el usuario con nombre verificado, rol `employee` y cargo nulo. Maneja creaciones concurrentes sin duplicar ni sobrescribir registros existentes.
- El cargo (`position`) es local y opcional para JIT; no condiciona el acceso. La importación administrativa exige cargo y permite seleccionar roles `employee`/`admin`.
- El administrador busca mediante `GET /api/users/assignable`; el backend consulta `GET /internal/users/assignable` de SIAU con HTTP Basic.
- `POST /api/users` revalida en `GET /internal/users/assignable/:externalKey`: solo admite funcionarios activos con SIREFO asignado, tomando la identidad de SIAU.
- La importación rechaza duplicados; `PATCH /api/users/:id` permite al administrador editar cargo y roles. No se importan contraseñas ni se crean identidades en SIAU.
- No hay vinculación automática de históricos por nombre, login o correo.

## Credenciales ASFI

Son independientes de SIAU y pertenecen al usuario local. `AsfiCredentials` guarda la contraseña cifrada con AES-256-CBC y `ENCRYPTION_KEY`.
`GET /api/asfi-crendentials` exige credenciales guardadas; si faltan, el flujo de funcionarios deriva a `/settings` y abre el diálogo de configuración.
El diálogo valida mediante `POST /api/asfi-crendentials/validate` antes de guardar con `PATCH /api/asfi-crendentials`; permite actualizarlas voluntariamente.
El administrador, previa confirmación, usa `DELETE /api/asfi-crendentials/:userId` para eliminar el registro local; no falla si ya estaba ausente para ese usuario.
El restablecimiento obliga a configurarlas nuevamente en SIREFO y no modifica la contraseña en ASFI ni en SIAU.

## Configuración y rutas

| Configuración | Uso |
| --- | --- |
| `SIREFO_PUBLIC_URL` | URL pública canónica del backend; determina callback y opciones de cookie. |
| `SIREFO_UI_URL` | Frontend opcional para redirecciones; si se omite, se usa `SIREFO_PUBLIC_URL`. |
| `IDENTITY_HUB_PUBLIC_URL` | URL pública de autorización de SIAU y emisor exacto esperado. |
| `IDENTITY_HUB_INTERNAL_URL` | Base opcional para token, JWKS, directorio y logout; por defecto, la URL pública de SIAU. |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | Credenciales confidenciales del backend registrado en SIAU. |
| `SESSION_TTL_SECONDS` | Duración absoluta; valor predeterminado `36000`. |

Registrar en SIAU las URLs completas del backend:

- `launchUrl`: `${SIREFO_PUBLIC_URL}/auth/login`.
- `redirectUris`: incluir exactamente `${SIREFO_PUBLIC_URL}/auth/callback`.
- `backchannelLogoutUri`: `${SIREFO_PUBLIC_URL}/api/auth/backchannel-logout`, accesible desde SIAU.

Solo `GET /auth/login` y `GET /auth/callback` están fuera del prefijo `/api`.
Con UI en otro origen, `SIREFO_UI_URL` habilita CORS con credenciales para ese origen; Angular envía cookies mediante `withCredentials` a su API.
