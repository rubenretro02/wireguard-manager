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
- Solo routers `linux-ssh` se aprovisionan automáticamente (MikroTik pendiente).
- La miniapp necesita HTTPS público — para probar en local usar un túnel (ngrok/cloudflared)
  y apuntar `NEXT_PUBLIC_APP_URL` + el bot ahí.
- El QR se genera client-side con `qrcode` (nueva dep) — nunca mandar la config a servicios externos.
- `tg_customer_peers` guarda la private key del cliente: es lo que permite re-mostrar config y QR.

**Pendiente / TODO:**
- Soporte MikroTik en provisioning.
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
