# CLAUDE.md

Registro de cambios y contexto técnico para futuras sesiones con Claude Code.
Complementa `RESUME.md` (visión general del producto) con detalles de implementación.

---

## Stack y rutas críticas

- **Next.js 15 + App Router** (`src/app/**`)
- **Supabase** Auth + Postgres (`src/lib/supabase/*`)
- **MikroTik** vía `routeros-client` (`src/lib/mikrotik.ts`)
- **Linux SSH** vía `ssh2` con pool reutilizable (`src/lib/linux-wireguard.ts`)
- **Crypto WG**: `tweetnacl` (`src/lib/wireguard-keys.ts`)
- **UI**: shadcn/Radix + Tailwind (`src/components/ui/*`)

### API principal
Toda la lógica WG entra por `POST /api/wireguard` con `{ action, routerId, data }`.
Branch principal: `if (connectionType === "linux-ssh") { ... } else { MikroTik ... }`.
Acciones implementadas: ver `src/app/api/wireguard/route.ts`.

### Tabla `routers` — campos relevantes
- `connection_type`: `"api" | "api-ssl" | "rest" | "rest-8443" | "linux-ssh"`
- Linux: `ssh_port`, `ssh_key`, `ssh_auth_method`, `wg_interface`, `out_interface`
- Red: `public_ip_prefix`, `public_ip_mask`, `internal_prefix`

---

## Pre-requisitos servidores Linux

1. `openssh-server` instalado y corriendo
2. `wireguard-tools` instalado (`apt install wireguard-tools`)
3. **NOPASSWD sudo** para el usuario SSH (ver README):
   ```
   USER ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick, /sbin/iptables, /usr/sbin/iptables, /sbin/ip, /usr/sbin/iptables-save, /bin/cat, /bin/ls, /bin/systemctl, /usr/bin/bash, /usr/bin/tee, /bin/chmod, /bin/rm
   ```
   *(Si se agregan acciones que ejecuten más binarios, ampliar la línea NOPASSWD.)*
4. Si se va a crear interfaces nuevas también permitir `/bin/systemctl`, `/usr/bin/tee`, `/bin/chmod`, `/bin/rm` (ya incluidos arriba).

---

## Historial de cambios

### 2026-08-24 — White-label: dominios por tenant (v26, fase 1)

**Motivo:** cuando AT&T cambie el bloque de IPs no vamos a tener acceso al viejo, así que los
endpoints por IP se mueren. Además cada semi-admin (homevpn) quiere su propia marca.

**Migración SQL:** `scripts/migration-v26-white-label-domains.sql` — `profiles.endpoint_domain`,
`profiles.panel_domain` (unique, case-insensitive), `profiles.brand_name`, y en `routers`:
`endpoint_slug` (prefijo DNS del server) + `endpoint_domain` (default global).

**Por qué `<slug>.<dominio>` y no un solo nombre:** un hostname resuelve a UNA IP; los peers viven
en servers distintos, así que cada server necesita su propio registro A bajo el dominio del tenant
(`tx.zone.homevpn.com`, `oh.zone.homevpn.com`). El tenant configura solo el dominio base.

- `src/lib/endpoint-domain.ts` (nuevo): `normalizeDomain`, `isValidDomain`, `slugFromRouterName`,
  `buildEndpointHost` y `buildEndpointResolver(admin, router)` — resuelve el dominio subiendo por
  `created_by_user_id`: creador → padre → … → `routers.endpoint_domain` → null (= IP, como antes).
  Cachea `profiles` 30s porque el dashboard pollea cada 3s; guard anti-ciclos.
- `/api/wireguard getPeers` (Linux y MikroTik) adjunta `endpoint_host` a cada peer; el dashboard lo
  usa en `generateConfig`/`generateEditableConfig` con fallback a la IP pública.
- `/api/profile/domains` (nuevo, runtime nodejs): GET devuelve dominios + los registros A que hay que
  crear (uno por server, con su IP destino); POST guarda (valida y normaliza) o hace `action:"check"`
  que resuelve con `dns.resolve4` para verificar que apunta bien.
- `/profile`: sección "Your domains" (solo admins y `can_create_users`) con los 3 campos, la lista de
  registros DNS con copiar y "Check DNS".
- Admin → editar router: campos **Endpoint Slug** y **Default Endpoint Domain**.

**Gotchas:**
- Sin correr la migración todo degrada solo (los selects fallan → `endpoint_host` null → se sigue
  usando la IP). Nada se rompe.
- Los configs YA entregados no cambian: el dominio solo aplica a lo que se descargue de ahora en más.
- La Mini App de Telegram sigue usando `tg_customer_peers.public_ip` (fase 3).
- Falta (fase 2): alta automática del dominio del panel en Dokploy y branding por Host header.

### 2026-08-20 — Un solo timer de expiración (dashboard ↔ tienda Telegram) v24

**Síntoma:** los peers de `/admin/telegram?tab=peers` se apagaban solos aunque el admin les extendiera
el tiempo, y los que habilitaba a mano se caían al rato. En el dashboard, renovar un peer vencido lo
habilitaba y guardaba la fecha nueva, pero al minuto quedaba disabled otra vez.

**Causa raíz:** había DOS relojes independientes que nunca se hablaban.

| Timer | Tabla | Quién lo escribía |
|---|---|---|
| Dashboard | `peer_metadata.expires_at` + `auto_disable_enabled` | El navegador, directo a Supabase |
| Tienda TG | `tg_customer_peers.expires_at` | Solo el servidor (`tg-store.ts`, `tg-admin`) |

El único puente era una copia **de una sola vez** al asignar un peer (`tg-admin` `assignPeerToCustomer`);
después las dos fechas divergían para siempre. El que apagaba los peers era el loop del navegador en
`dashboard/page.tsx`: miraba **solo** `peer_metadata.expires_at` y llamaba `disablePeer`. En Linux
"disable" borra la llave de `wg`, así que a los ~3 s `getLiveStatusesForPeers` veía el peer ausente y
escribía `tg_customer_peers.status='disabled'` — el extend de TG quedaba enterrado.

Dos agravantes: (1) el loop corría cada ~3 s y no cada 60 s, porque `autoDisableExpiredPeers` cambiaba
de identidad en cada poll y recreaba el `setInterval`; (2) `fetchWireGuardData` hace `setPeers(...)` y
recién al final `await fetchPeerMetadata()`, así que había un render con el peer ya habilitado y la
metadata vieja → el efecto disparaba `disablePeer`.

**Migración SQL:** `scripts/migration-v24-unified-peer-expiry.sql` — agrega `peer_metadata.expiration_value`
y `expiration_unit` (la app las escribía desde siempre; ningún script las creaba) y hace el backfill en
3 pasos: TG sin timer apaga el timer del dashboard → `tg_customer_peers` se queda con `GREATEST` →
se espeja de vuelta a `peer_metadata`.

**Arquitectura:** `src/lib/peer-expiry.ts` (nuevo) es el **escritor único**. `setUnifiedExpiry()` escribe
`peer_metadata` y `tg_customer_peers` con el MISMO valor; `resolveExpiry()` centraliza `set` vs `extend`.
Módulo puro de DB (recibe el `SupabaseClient`), no importa `tg-store` — `tg-store` importa de acá.
`src/lib/time-units.ts` (nuevo) saca `convertToHours`/`convertToMilliseconds` del dashboard.

- `tg-store.ts`: `renewCustomerPeer` y el provisioning espejan la fecha a `peer_metadata`. `renewCustomerPeer`
  es el punto de mayor palanca: cubre el extend del admin, el webhook de Cryptomus y el checkout free.
- `/api/wireguard` acción nueva **`setPeerExpiry`** `{ publicKeys[], mode:"set"|"extend", value, unit, ... }`,
  gateada por `can_auto_expire`. Vive antes del branch Linux/MikroTik (es pura DB). El dashboard ya no
  escribe `peer_metadata` directo en Edit Timer / Renew / bulk: el navegador usa el cliente con RLS y
  `tg_customer_peers` es admin-only vía service role.
- **Renew del dashboard pasa a `extend`** (`max(ahora, fecha actual) + duración`, igual que TG). Antes
  los cuatro caminos hacían `ahora + duración`, así que renovar por 1d a un peer con 20 días le
  **recortaba** el tiempo y las fechas se volvían a separar.
- Loop de auto-disable: datos por refs (`peersRef`/`peerMetadataRef`) para que el intervalo de 60 s no
  se recree, ref de in-flight, y **relectura de la fecha en la DB antes de apagar** — aunque el snapshot
  en memoria esté viejo, nunca apaga un peer recién renovado.
- `/api/cron/enforce-peer-expiry` (nuevo): aplica el timer server-side aunque nadie tenga el dashboard
  abierto. Apaga vencidos, procesa `scheduled_enable_at`, y **auto-sana** los `tg_customer_peers` en
  `status='expired'` con fecha futura (los que el bug dejó muertos). Tiene un guard que nunca apaga un
  peer cuya fecha en la tienda está en el futuro o es NULL.

**Bugs adyacentes arreglados:** `enableCustomerPeer` hacía `new Date(peer.expires_at)` sin guard y
`new Date(null).getTime()` es 0 → ningún peer sin timer (v21) se podía habilitar nunca ("Peer is expired
— use Extend instead"). La rama MikroTik de `getLiveStatusesForPeers` no tenía el guard de dump vacío que
sí tenía Linux. `handleRenewPeer` usaba `.update()` en vez de upsert: con 0 filas afectadas Supabase no
devuelve error, así que la fecha se descartaba en silencio. `isPeerExpired`/`getTimeRemaining`/el gate de
enable miraban `expires_at` ignorando `auto_disable_enabled`.

**Gotchas:**
- `peer_metadata.router_id` es **TEXT** y `tg_customer_peers.router_id` es **UUID** → todo se joinea por
  `peer_public_key`. Por lo mismo `setUnifiedExpiry` actualiza TODAS las filas de `peer_metadata` con esa
  public key, no solo la del router seleccionado: con router-per-interface una fila olvidada con la fecha
  vieja seguiría apagando el peer.
- Sacar el timer en el dashboard ahora también lo saca en Telegram (es un solo timer, es lo buscado).
- Vercel Hobby solo permite crons diarios; para granularidad de minutos apuntarle cron-job.org a
  `/api/cron/enforce-peer-expiry`, igual que ya se hacía con `expire-customer-peers`.

### 2026-08-08 — Telegram como menú padre + filtros en Peers + "Created by" del dashboard

**Sin migraciones SQL.**

- `Sidebar.tsx`: **Telegram** deja de ser un link suelto y pasa a ser un submenú colapsable
  dentro de Admin Panel, con sus páginas hijas (Peers / Customers / Plans / IPs for Sale /
  Payments) apuntando a `/admin/telegram?tab=<x>`.
- `admin/telegram/page.tsx`: los tabs ahora se manejan por URL (`useSearchParams` + `router.replace`,
  envuelto en `Suspense` porque Next lo exige en prerender). **Peers es el tab por defecto**
  (`/admin/telegram` sin query → peers).
- Tab Peers: barra de filtros — buscador difuso, select de servidor, select de customer y chips
  de estado (All / Active / Expiring soon ≤7d / Expired / Disabled / No expiry) con contadores,
  contador "X of Y peers" y botón Clear. La columna Expires muestra "in Nd" / "Nd ago" en ámbar/rojo
  y el badge de estado agrega la variante `expiring`.
- `src/lib/fuzzy.ts` (nuevo): `fuzzyScore(fields, query)` estilo Google — insensible a
  acentos/mayúsculas, multi-término AND, substring primero ("amon" → "Ramon") y subsecuencia
  ajustada como fallback ("rmon" → "Ramon"). Con query activa la lista se ordena por relevancia.

**"Created by" del dashboard:** la columna y el sort "By Created" dependían SOLO de
`peerMetadata`, que el cliente lee con la sesión del usuario (RLS). Ahora `/api/wireguard getPeers`
adjunta `created_by_email` / `created_by_user_id` / `created_at` a cada peer leyendo con service role:
- Linux: `linux_peers` con fallback a `peer_metadata` (antes de ahí solo se sacaba el nombre).
- MikroTik: merge nuevo con `peer_metadata`, cacheado en `cachedRouterRead` (`mt-peer-meta:<routerId>`)
  para no pegarle a Supabase en cada poll de 3s; si falla, se ignora (el dato es cosmético).
- `dashboard/page.tsx`: la celda y el sort usan `meta?.… || peer.…`.

**Gotcha:** los peers creados a mano en el router (no desde la app) no tienen fila en ninguna tabla
→ siguen mostrando "—", no hay de dónde sacar el autor. Medido el 2026-08-08: Miami FL
76.245.59.200 (MikroTik) tenía 321 peers vivos y 168 filas en `peer_metadata`.

### 2026-08-06 — Backup de llaves de interfaces (Admin → Interfaces) v23

**Motivo:** la private key de cada interface WG solo vivía en `/etc/wireguard/<if>.conf`; al
formatear un server se pierde y TODOS los clientes deben re-descargar su config (pasó con TX y Ohio).

**Migración SQL:** `scripts/migration-v23-wg-interfaces.sql` — tabla `wg_interfaces`
(router_id, host, interface_name, listen_port, private_key, public_key, address, running,
peer_count, source, last_synced_at) con `UNIQUE(host, interface_name)` — la clave es host+interface
porque varias filas de `routers` pueden apuntar al mismo host (workflow router-per-interface).
RLS admin-only; la app usa service role.

- `linux-wireguard.ts`: `getInterfaceConfigs()` — usa `getInterfacesDetail()` para los nombres y
  hace `cat /etc/wireguard/<if>.conf` por cada uno, parseando PrivateKey/ListenPort/Address/[Peer].
- `wireguard-keys.ts`: `publicKeyFromPrivate()` (scalarMult.base, equivalente a `wg pubkey`).
- `/api/interfaces` (nuevo, runtime nodejs): GET lista la tabla; POST `{action:"sync", routerId?}`
  recorre TODOS los routers (uno por host, dedupe) y hace upsert. Guard admin vía service role.
  Linux: lee los `.conf`. MikroTik: `/interface/wireguard` expone `private-key` y `public-key`
  directo (verificado en RouterOS 7 por REST; el cliente clásico ya mapea `privateKey`→`private-key`).
  MikroTik no tiene Address en la interface (vive en `/ip/address`) → esa columna queda vacía.
- `route.ts` `createLinuxInterface`: guarda el keypair en `wg_interfaces` al crear (source `created`).
- Admin: pestaña **Interfaces** (+ link en Sidebar) con tabla server/interface/port/address/
  public key/private key (oculta con ojo + copiar)/peers/last synced, botones "Sync from servers"
  y "Download JSON".

**Gotcha:** el sync necesita SSH vivo; los servers caídos se listan como error pero no borran lo ya
guardado. Correr el sync después de crear interfaces a mano por SSH.

### 2026-08-06 — Script de restauración de servers formateados

`scripts/restore-linux-server.mjs` — reconstruye un server linux-ssh formateado desde Supabase:
paquetes base, user del panel (fila `routers`) + sudoers NOPASSWD, interface WG (keypair NUEVO,
mismo listen_port desde `tg_customer_peers`), 253 IPs públicas + SNAT desde `public_ips`,
y todos los peers enabled de `linux_peers` con sus mismas llaves/IPs. Idempotente.
Uso: `node scripts/restore-linux-server.mjs --host <ip> --ssh-user X --ssh-pass Y [--dry-run]`.

**Gotcha clave:** la private key de la interface del server NO está en la DB (solo en el .conf
del server) — al restaurar se genera keypair nuevo y los clientes deben re-descargar su config
(solo cambia la PublicKey del server). El script actualiza `tg_customer_peers.server_public_key`.
Después de restaurar, descargar un backup del panel (Admin → Backups): es el único lugar donde
queda la private key. Usado el 2026-08-06 para el TX 12.164.34.2 (formateado; 90 peers, 253 IPs).

### 2026-08-03 — Peers visibles con el server caído (fallback a DB, todos los tipos)

**Problema:** con un server caído (caso real: Clif FL), dashboard y Public IPs mostraban 0 peers.
Causa raíz: `getPeersForInterface`/`getPeers`/`getInterfaceInfo` en `linux-wireguard.ts` tragaban
el error SSH y devolvían `[]`/`null` — `cachedRouterRead` lo cacheaba como lectura buena
(`stale:false`), el dashboard pintaba 0 y sobreescribía `wg_peer_cache` (localStorage) con la
lista vacía. Colateral: la Mini App (`tg-store.ts`) veía `stale:false` con dump vacío y persistía
`status='disabled'` en `tg_customer_peers` durante el outage.

**Cambios (sin migraciones SQL):**
- `linux-wireguard.ts`: esas 3 funciones ahora relanzan el error (contrato SWR de `cachedRouterRead`).
- `route.ts` getPeers Linux: try/catch por interface + flag `routerDown`; con server caído incluye
  TODOS los `linux_peers` ausentes del dump (no solo disabled) → lista reconstruida desde DB.
- `route.ts` getPeers MikroTik: si `cachedRouterRead` lanza (cold start + router caído), reconstruye
  desde `peer_metadata` + deriva la IP pública (comment) matcheando el prefijo /24 de
  `allowed_address` contra `public_ips.internal_subnet`. Solo peers creados desde la app.
- Respuesta getPeers (ambos): `{ peers, stale, fetchedAt?, routerDown?, source: "db"|"live" }`.
- `mikrotik.ts` REST: `getWireGuardPeers`/`getWireGuardInterfaces` normalizan a array (body vacío
  devolvía `{}` y envenenaba la caché).
- `dashboard/page.tsx`: guard `Array.isArray(peerData.peers)`, estado `routerDown`, banner
  "Server down — showing saved peers (last seen …)".
- `public-ips/page.tsx` + `admin/page.tsx` (fetchPeerCounts): guard + indicador ámbar
  "Server unreachable — peer data may be outdated". Conteos por IP funcionan con el fallback
  (comment viene poblado desde DB).
- `tg-store.ts:719`: sync requiere `!read.stale && read.data.length > 0` (cinturón anti-corrupción).
- SOCKS5: sin cambios — la lista ya es DB-first (`socks5_proxies`).

**Gotcha:** con el fallback DB los peers salen con `disabled` real (Linux) o `disabled:false`
(MikroTik, estado desconocido) y sin handshake/rx/tx → se ven Disconnected, correcto.

### 2026-06-14 — Login de admin/semi-admin desde Telegram (v22)

**Qué es:** los admins y semi-admins (cuentas de `profiles` / Supabase Auth, NO `tg_customers`)
pueden vincular su Telegram y entrar al panel desde el bot, sin escribir contraseña. Reusa el
bot de agents `@Wireguardvpnmanagerbot`; el acceso solo se ofrece a perfiles vinculados (se
chequea `from.id`), así clientes/agents normales nunca lo ven.

**Migración SQL:** `scripts/migration-v22-admin-telegram-login.sql` — agrega
`profiles.telegram_id` (UNIQUE) + `telegram_username` + `telegram_linked_at`, y la tabla
`admin_tg_tokens` (tokens de un solo uso, `purpose 'link'|'login'`, TTL link 10m / login 60s,
single-use vía `used_at`; RLS admin-only, la app usa service role).

**Arquitectura (`src/lib/admin-tg-auth.ts`):**
- `issueToken`/`consumeToken` (claim atómico: UPDATE con `used_at IS NULL AND expires_at > now`).
- `linkTelegramToProfile`/`unlinkTelegram`/`getProfileByTelegramId`.
- `mintSession(cookieClient, userId)`: acuña la sesión sin contraseña — `auth.admin.generateLink({type:'magiclink'})`
  (service role) → `cookieClient.auth.verifyOtp({type:'email', token_hash})` que escribe las cookies
  (mismo mecanismo que `exchangeCodeForSession` en `/api/auth/callback`). La sesión resultante es la
  del propio usuario → RLS/rol/capabilities sin cambios.

**Flujos:**
- *Vincular:* `/profile` (nueva, en el Sidebar, todos los roles) → `POST /api/profile/telegram`
  emite token `link` y devuelve deep link `t.me/<bot>?start=link_<token>` (+ QR con `qrcode`).
  El webhook agent maneja `/start link_<token>` → `linkTelegramToProfile(from)`.
- *Login (link a navegador real):* en el bot `/admin` → webhook emite token `login` (solo si el
  `from.id` está vinculado) → botón url `…/api/auth/tg-login?token=…` → `GET` valida, mintea sesión,
  redirige a `/dashboard`.
- *Login (Mini App):* botón web_app "🖥 Panel admin" → `/tg/admin` lee `initData` → `POST
  /api/auth/tg-miniapp-login` (valida HMAC con `validateInitData`, busca perfil, mintea) →
  `window.location.replace('/dashboard')` dentro del webview.

**Webhook (`/api/telegram/webhook`):** reordenado solo para el bot agent (store intacto):
`/start link_*` → vínculo; `/admin` → login link; default → "Open App" (y si el `from.id` es admin
vinculado, además agrega el botón del panel).

**Setup:** `node scripts/setup-telegram-webhook.mjs` ahora también hace `setMyCommands` del bot
agent con `/admin`. Sin env nuevas (reusa `TELEGRAM_AGENT_BOT_TOKEN` + `NEXT_PUBLIC_APP_URL`).
El deep link usa `getMe` (cacheado) para el username del bot.

**Gotchas / pendiente:**
- No se puede probar en local (sin `.env.local`, Supabase da exception y el bot necesita HTTPS
  público): probar en Vercel o con túnel.
- Confirmar el `type` de `verifyOtp` para magic links en la versión de supabase-js (se usó `'email'`;
  fallback `'magiclink'` si rechaza).
- TODO: rate-limit de `/admin` y de generación de tokens (hoy: solo TTL + single-use).

### 2026-06-11 — Telegram Mini App + tienda con Cryptomus

**Qué es:** Mini App de Telegram (`/tg`) donde los customers finales se registran solos
(login automático con `initData`), compran acceso VPN, ven el estado/config de sus peers
(QR + .conf) y renuevan pagando con cripto vía Cryptomus. Panel admin en `/admin/telegram`.

**Migración SQL:** `scripts/migration-v16-telegram-store.sql` — tablas `tg_customers`,
`tg_plans`, `tg_customer_peers`, `tg_payments` (RLS admin-only; la app usa service role).

**Arquitectura:**
- Auth miniapp: cada request a `/api/tg/*` manda el `initData` crudo en header `x-tg-init-data`;
  se valida el HMAC en cada request (stateless, ver `src/lib/telegram.ts` + `src/lib/tg-auth.ts`).
  El customer se upserta por `telegram_id`.
- Provisioning: `src/lib/tg-store.ts` — replica el flujo `createPeerSimplified` (Linux SSH only):
  elige public IP (del plan o auto), siguiente IP interna libre (cruza `wg show` + `linux_peers`
  + `tg_customer_peers` porque los peers disabled no aparecen en wg), genera llaves, `addPeer`,
  inserta en `linux_peers` (para que se vea en el dashboard normal) y en `tg_customer_peers`
  con server_public_key/listen_port/endpoint para armar la config sin SSH.
- Pagos: `src/lib/cryptomus.ts`. Checkout crea `tg_payments` pending + invoice; el webhook
  `/api/cryptomus/webhook` verifica firma (MD5 base64 + API key, con escape `\/` estilo PHP)
  y hace fulfillment idempotente (claim atómico vía `fulfilled_at IS NULL`). Si el fulfillment
  falla devuelve 500 para que Cryptomus reintente. Planes con precio 0 = fulfill inmediato (trial).
- Renovación: extiende desde `max(now, expires_at)`; si estaba expired/disabled re-agrega el peer
  a WG con la MISMA llave/IP (la config del cliente no cambia).
- Expiración: `/api/cron/expire-customer-peers` (Bearer CRON_SECRET) quita de WG, marca expired
  y notifica por bot. `vercel.json` lo corre diario (Hobby no permite más granularidad);
  para granularidad horaria usar cron-job.org contra ese endpoint.
- Bot: `/api/telegram/webhook` responde a /start con botón web_app. Registrar con
  `node scripts/setup-telegram-webhook.mjs` (también setea el menu button).

**Env nuevas:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`,
`CRYPTOMUS_MERCHANT_ID`, `CRYPTOMUS_PAYMENT_API_KEY`, `CRON_SECRET` (ver `.env.example`).

**Gotchas:**
- Provisioning soporta `linux-ssh` Y MikroTik (api/api-ssl/rest). Linux: add/remove por SSH +
  espejo en `linux_peers`. MikroTik: createWireGuardPeer con private-key propia (la public key
  se calcula local), disable/enable nativo, used-IPs desde el propio router (los disabled siguen
  visibles). Identificación de peers MikroTik por public key (no se guarda el .id del router).
- La miniapp necesita HTTPS público — para probar en local usar un túnel (ngrok/cloudflared)
  y apuntar `NEXT_PUBLIC_APP_URL` + el bot ahí.
- El QR se genera client-side con `qrcode` (nueva dep) — nunca mandar la config a servicios externos.
- `tg_customer_peers` guarda la private key del cliente: es lo que permite re-mostrar config y QR.

**v17 — IPs en venta:** `scripts/migration-v17-ips-for-sale.sql` agrega `public_ips.for_sale`.
El provisioning automático SOLO usa IPs `for_sale = true` (elige la menos cargada por peers
activos); las demás quedan reservadas para uso propio/dedicated. Toggle en
Admin → Telegram → "IPs en venta". Dedicated = fijar `public_ip_id` en el plan.

**v18 — Peers asignados + rotación de llaves:** `scripts/migration-v18-assigned-peers.sql`
hace `peer_private_key` nullable. El admin puede asignar peers YA existentes a un customer
(IPs for Sale → click peer → Assign): el customer los ve en la app (estado, días restantes,
renovar) pero sin enable/disable. Si no se conoce la private key (peers MikroTik manuales),
la app no muestra config y ofrece "Generate new keys" (rotateKeys) que regenera el keypair
en el servidor conservando IP/nombre. Customers también clickeables en el admin (peers+pagos).

**v19 — Customer types + renewal pricing por peer:** `scripts/migration-v19-customer-types-renewal-pricing.sql`.
`tg_customers.customer_type`: 'client' (ve la tienda) | 'agent' (la app solo muestra sus peers:
sin Buy/Payments/precios/Renew; checkout devuelve 403). `tg_customer_peers.renewal_price_usd`
+ `renewal_duration_days`: precio propio de renovación para peers asignados — el customer renueva
con Cryptomus a ese precio sin plan (webhook usa esos días si payment.plan_id es null). Admin:
columna Type en Customers, botón "Assign existing peer" en Peers (server→peer→customer+pricing),
botón $ por peer para editar pricing, y la pestaña IPs sin server muestra TODAS las for-sale.

**Bots separados (store/agent):** `TELEGRAM_AGENT_BOT_TOKEN` (@Wireguardvpnmanagerbot) además del
store bot (@blackgoatvpn_bot). `validateInitData` prueba ambos tokens y devuelve `bot`; quien se
registra por el bot agent se crea con `customer_type='agent'` (cuentas existentes nunca se pisan).
Webhook compartido: `/api/telegram/webhook` (store) y `?bot=agent` (agent), mismo secret.
Notificaciones salen por el bot del tipo del customer (`botForCustomerType`). El setup script
configura ambos bots si el token agent está presente.

**v20 — Display names + dedicated IPs:** `scripts/migration-v20-display-names-dedicated.sql`.
`tg_customer_peers.display_name`: el customer ve/edita "Peer N" (acción `rename` en /api/tg/peers);
el admin sigue viendo `peer_name` del sistema. `tg_plans.is_dedicated_ip` + `public_ips.sale_dedicated`:
planes dedicated aprovisionan SOLO en IPs for-sale dedicated y cada una admite UN customer activo;
planes normales solo usan las shared. Admin: switch Dedicated en IPs for Sale (per-server y global),
toggle en el plan, acción `unassignPeer` (quita la asignación sin tocar el peer del server, botón
UserMinus en Peers). Mini App: lápiz para renombrar, badge "Dedicated IP" en planes, nota de
soporte para pedir dedicated IPs.

**v21 — Expiración opcional + Mini App multi-página:** `scripts/migration-v21-optional-expiry.sql`
hace `tg_customer_peers.expires_at` nullable. Al asignar: días explícitos > timer del dashboard
(`peer_metadata.expires_at` si auto_disable_enabled) > NULL (sin timer; la app no muestra fecha y
el cron lo ignora). El sync ahora marca "expired" (no "disabled") cuando la fecha ya pasó.
Mini App: tabs Dashboard (resumen: total/online/active/expirados + próxima expiración) /
My Peers (con buscador por nombre/IP/estado y chips de filtro) / My Proxies (placeholder SOCKS5) /
Buy / Payments (agents solo ven los 3 primeros).

**Pendiente / TODO:**
- Recordatorio de renovación (N días antes de vencer) — requiere tracking de último aviso.
- Límite de peers por customer / anti-abuso de planes gratis (hoy: un trial por click).



### 2026-05-26 — Scoping de peers por router + UI simplificada (post-mortem)

**Contexto:** Se descubrió que el usuario ya manejaba múltiples interfaces creando **un "router" config por interface**, todos apuntando al mismo host pero con `wg_interface` distinto. El feature anterior (per-IP override) rompió ese flujo al mezclar peers de todas las interfaces del server en cada vista.

**Cambios:**
- `src/app/api/wireguard/route.ts`: `getPeers` (Linux) ahora muestra peers SOLO de las interfaces que pertenecen al router seleccionado: `{ router.wg_interface } ∪ { public_ips.wg_interface where router_id = X }`. Las interfaces huérfanas (sin público_ips asignadas a este router) se filtran. Cada config router-por-interface sigue funcionando como antes.
- `src/app/admin/page.tsx`: simplificación UI.
  - El dropdown global "WG: [wg0 ▾]" al lado de Connected → reemplazado por un **Badge informativo** que solo muestra `router.wg_interface` (read-only). El usuario configura la interface al editar el router, no acá.
  - Selectores wg_interface en modales Add IP / Bulk Add → quitados. Las IPs heredan automáticamente.
  - Columna WG editable inline en la tabla → quitada. Inconsistente con el modelo "router per interface".
  - Estado/handlers no usados → eliminados.

**Lo que queda del feature per-IP:**
- Columna `public_ips.wg_interface` (NULL = inherit) sigue ahí — sin UI directa pero permite overrides server-side si en el futuro hace falta.
- Backend: `addWgIpAddress`, `createMikroTikRules`, `addPeer` aceptan override y `getPeers` lo respeta.

**Lecciones aprendidas:**
- **Preguntar antes de inventar.** El usuario ya tenía un workflow funcional (router-per-interface). Asumí que era una limitación y la "arreglé" con un feature elaborado. Resultado: rompí algo que funcionaba.
- Verificar el modelo mental del usuario antes de migrar el data model.
- Mantenerse con "el cambio más pequeño que resuelve el problema" — en este caso era solo cambiar el getPeers para que cada router viera lo suyo.

---

### 2026-05-26 — Per-IP wg_interface (multi-interface en un solo server)

**Motivo:** Cada router tenía un único `wg_interface`, por lo que TODAS las IPs públicas se forzaban a usar la misma. Imposible repartir IPs entre `wg0`, `wg1`, etc. en un mismo server.

⚠️ **Ver entrada de más arriba — el UI fue revertido/simplificado.** La capa de DB y backend de este cambio se mantiene como base por si en el futuro hace falta.

**Migración SQL:** `scripts/migration-v15-per-ip-wg-interface.sql` — agrega columna `wg_interface TEXT` (nullable) a `public_ips` + índice. Backwards-compatible: NULL = heredar de `routers.wg_interface`.

**Archivos modificados:**
- `src/lib/types.ts` — `PublicIP.wg_interface: string | null`
- `src/lib/linux-wireguard.ts`
  - `addWgIpAddress`, `removeWgIpAddress`, `createMikroTikRules`, `deleteMikroTikRules`, `addPeer` aceptan `wgInterfaceOverride?: string`.
  - `removePeer` con fallback: si no se le da interface, prueba la default y luego escanea todas.
  - Nuevos: `getPeersForInterface(name)` y `getPeersAllInterfaces()` para agregar peers desde TODAS las interfaces (cada peer queda etiquetado con su `interface`).
- `src/app/api/wireguard/route.ts`
  - `createMikroTikRules` y `deleteMikroTikRules` consultan `public_ips.wg_interface` antes de invocar al cliente.
  - `createPeerSimplified` usa `publicIp.wg_interface || data.interface`.
  - `getPeers` (Linux) ahora usa `getPeersAllInterfaces` — un solo router con N interfaces muestra peers unificados.
- `src/app/api/public-ips/route.ts`
  - POST acepta `wg_interface` (single + bulk).
  - PATCH lo agrega a `allowedFields`, normaliza `""` → NULL.
- `src/app/admin/page.tsx`
  - Estados: `availableWgInterfacesForIps`, `defaultWgInterfaceForIps`, `newIpWgInterface`, `bulkWgInterface`, `editingIpWgInterface`.
  - Carga interfaces detectadas al cambiar `selectedRouterForIps`.
  - Dropdown global "WG: [wg0 ▾]" al lado del badge Connected (default para Add IP y Bulk Add).
  - Dropdowns en los modales Add IP y Bulk Add, con opción "(inherit from router)".
  - Nueva columna **WG** en la tabla de Public IPs con botón que abre Select inline para cambiar la interface — amber si la IP tiene override, muted si hereda del router.

**Gotchas / lecciones:**
- El campo en DB es nullable a propósito: para no perder retro-compatibilidad y tener un fallback claro (`router.wg_interface`). Todo el código siempre debe usar `publicIp.wg_interface || router.wg_interface`.
- `getPeers` ahora hace N calls SSH (uno por interface). El pool ssh2 mitiga el overhead; aún así, en servidores con muchas interfaces puede ser más lento. Si pesa, considerar cachear `wg show all dump` en una sola llamada.
- Al crear las reglas para una IP que cambió de interface, **no se limpia la interface vieja**. Si moves IP 66 de wg0 a wg1, hay que correr "Delete Rules" en wg0 primero, después "Create Rules" para que cree en wg1. TODO: handler que detecte el cambio y haga la migración atómica.

**Pendiente / TODO:**
- Validar colisiones al crear rules: si `10.10.66.0/24` ya está en wg3, no permitir agregarlo a wg0.
- Migración automática "mueve IP X de wgY a wgZ" que limpie el viejo y cree el nuevo en un paso.
- Detect & clean orphans (NAT rules a bloques inexistentes, addresses huérfanas) — flagged en el chat del 2026-05-26 pero no implementado.
- Replicar dropdown global en `/public-ips` (usuarios no-admin) si tiene sentido para ellos.

---

### 2026-05-26 — Crear interfaces WireGuard desde la UI (Linux SSH)

**Motivo:** El manager solo gestionaba peers; las interfaces (`wg0`, `wg1`, …) había que crearlas manualmente por SSH.

**Archivos modificados:**
- `src/lib/linux-wireguard.ts`
  - `getInterfacesDetail()` — devuelve `[{ name, port, running }]`. Combina `wg show all listen-port` con parsing de `/etc/wireguard/*.conf` para incluir interfaces apagadas.
  - `createInterface({ name, listenPort, address, privateKey })` — valida colisiones nombre/puerto, escribe conf por **base64** (evita problemas de quoting con `sudo -S`), `chmod 600`, `systemctl enable && start`, verifica con `wg show`, hace cleanup si falla.
- `src/app/api/wireguard/route.ts`
  - Acción `getSystemInterfaces` ahora devuelve `wgInterfacesDetail` (con puertos), no solo nombres.
  - Nueva acción `createLinuxInterface` — genera llaves con `generateKeyPair()`, llama al cliente, registra en `activity_log`.
- `src/app/admin/page.tsx`
  - Estado: `detectedWgInterfacesDetail`, `createIfaceOpen`, `newIfaceData`, `newIfaceError`, `creatingIface`.
  - Dropdown WG con opción `"+ New Interface..."` y botón `+` al lado (solo si `connection_type === "linux-ssh"`).
  - Diálogo nuevo con campos Name / Listen Port / Address y sugerencias automáticas (siguiente `wgN` libre, `max(port)+1`, `<internal_prefix>.0.1/24`).
  - Validación cliente + servidor; tras crear, refresca y auto-selecciona.

**Migraciones SQL:** Ninguna. No se tocaron tablas.

**Gotchas / lecciones:**
- `executeCommand` en `linux-wireguard.ts` prepende `echo 'PWD' | sudo -S <cmd>`. Para escribir archivos con contenido arbitrario, usar **base64** y `bash -c 'echo <b64> | base64 -d > ruta'`. Evita problemas con comillas, newlines y `$`.
- El verify post-create usa `wg show <name>` — si la interface se cae a los segundos por mala config, igual reporta éxito. TODO: chequear `systemctl is-active` después.
- El SelectItem con `value="__new__"` es un hack para abrir el dialog desde el dropdown; mantener si se replica en otros formularios (add-router también necesita esto en el futuro).

**Pendiente / TODO:**
- Replicar el dropdown "+ New Interface" en el formulario de **add router** (ahora solo está en edit-router).
- Soporte para crear interfaces en MikroTik (actualmente solo Linux).
- UI para **eliminar** una interface desde la app (hoy se hace por SSH manual: `wg-quick down + systemctl disable + rm .conf`).
- Permitir editar `PostUp`/`PostDown` opcionales (forwarding, masquerade).

---

## Convenciones de este repo

- Acciones API usan kebab-case en el body pero los campos internos siguen el dialecto de cada plataforma: MikroTik usa `"public-key"`, `"allowed-address"`, etc.; Linux usa camelCase en el lib y se traduce en el route.
- IDs en respuestas Linux se prefijan con `*` cuando son sintéticos (no vienen de Supabase).
- Activity log siempre vía `logActivity()` de `src/lib/activity-logger.ts`, no insertar directo en la tabla.
- Connection pool SSH cierra conexiones idle a los 60s; no asumir que la conexión persiste entre requests largos.

---

## Deploy

- **Vercel Hobby** no despliega commits de colaboradores externos. Si "Same" hace commits, abrir PR y mergear con la cuenta principal (ver `RESUME.md`).
- Variables de entorno requeridas en Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- `runtime = "nodejs"` está forzado en `/api/wireguard/route.ts` y `/api/routers/resources/route.ts` porque `ssh2` necesita módulos nativos (no funciona en Edge).

---

## Errores comunes (para no entrar en bucle)

| Síntoma | Causa real | Fix |
|---|---|---|
| `"sudo: a terminal is required to read the password"` | Usuario SSH sin NOPASSWD | Ver bloque `visudo` arriba |
| `"No interfaces found"` al cargar dropdown | `wg show` falla (sin sudo) o no hay `.conf` | Ejecutar `sudo wg show` a mano y diagnosticar |
| Crear interface devuelve `"Interface did not start"` | Conflicto de puerto no detectado, o `wg-quick` falla | Revisar `journalctl -u wg-quick@wgN` en el servidor |
| TypeScript falla en build pero `tsc --noEmit` local pasa | `node_modules` desincronizado en Vercel | Limpiar cache de build en Vercel |
| Cambios no se ven en prod | Commit de colaborador no se desplegó | Merge desde GitHub con cuenta dueña |


---

# Karpathy coding guidelines (appended)

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
