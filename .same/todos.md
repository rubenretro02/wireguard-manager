# WireGuard Manager - Rediseño Completo

## Completado ✅

### UI/UX
- [x] Nuevo diseño dark mode moderno (estilo Vercel/Linear)
- [x] Sidebar con navegación
- [x] Stats cards (Total peers, Active, Disabled, Subnets)
- [x] Tabla moderna con iconos
- [x] Botón de lápiz para editar nombre del peer
- [x] Botón para invertir orden (más recientes arriba)
- [x] Force Refresh button
- [x] Eliminado modo demo

### Backend
- [x] Función clearClientCacheForRouter para limpiar caché
- [x] API updatePeer para editar nombre
- [x] Mejor logging para debugging

## Pendiente 📋

### Prioridad Alta
- [ ] Agregar campos de configuración IP al router (Admin Panel):
  - public_ip_prefix (ej: 76.245.59)
  - public_ip_mask (ej: /25)
  - internal_prefix (ej: 10.10)
  - out_interface (ej: ether2)
  - wg_interface (ej: wg0)

- [ ] Crear tabla `public_ips` en Supabase
- [ ] Crear tabla `user_routers` para control de acceso

- [ ] Auto-import desde MikroTik (solo lectura):
  - Detectar NAT rules existentes
  - Detectar IPs públicas
  - Mapear configuración

### Prioridad Media
- [ ] Simplificar creación de peer:
  - Dropdown de IPs públicas (solo las configuradas por admin)
  - Auto-asignar IP interna disponible

- [ ] Admin Panel:
  - Agregar/gestionar IPs públicas
  - Control de acceso por usuario/router

### Prioridad Baja
- [ ] Crear reglas automáticamente al agregar IP pública:
  - IP en ether2
  - NAT rule
  - IP en WireGuard interface

## Notas
- El error de Supabase es esperado (faltan variables de entorno en este workspace)
- Para ver el nuevo diseño, hay que deployar con las credenciales correctas...
