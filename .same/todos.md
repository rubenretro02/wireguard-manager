# WireGuard Manager - Nuevas Funcionalidades

## Tareas Pendientes

### 1. Columnas Created At/By en Dashboard para Peers
- [ ] Agregar columnas Created At y Created By en tabla de peers
- [ ] Guardar metadata de peers en base de datos

### 2. Sistema de Auto-Disable/Enable por Tiempo
- [ ] Agregar campo expires_at en peer_metadata
- [ ] Crear sistema de expiración por horas o días
- [ ] Capability para habilitar esta función por usuario

### 3. Sistema de Capabilities por Usuario
- [ ] Agregar campo capabilities en profiles (JSON)
- [ ] Capabilities: can_auto_expire, can_see_all_peers
- [ ] UI en admin para gestionar capabilities

### 4. Modal Interactivo de Peers desde IP
- [ ] Hacer peers clickeables en el modal
- [ ] Agregar botones: Enable/Disable, Edit, Delete
- [ ] Dialog para editar peer

### 5. Filtro de Peers por Creador
- [ ] Usuarios solo ven sus peers
- [ ] Capability para ver todos los peers
- [ ] Admins ven todos

### 6. Bug Fix: Usuario no puede crear peer
- [ ] Arreglar problema de IPs públicas vacías para usuarios

## Progreso
- [ ] Crear migración SQL
- [ ] Actualizar tipos TypeScript
- [ ] Modificar APIs
- [ ] Modificar Dashboard
- [ ] Modificar Admin Panel
