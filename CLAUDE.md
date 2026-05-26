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
