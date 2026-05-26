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

### 2026-05-26 — Per-IP wg_interface (multi-interface en un solo server)

**Motivo:** Cada router tenía un único `wg_interface`, por lo que TODAS las IPs públicas se forzaban a usar la misma. Imposible repartir IPs entre `wg0`, `wg1`, etc. en un mismo server.

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
