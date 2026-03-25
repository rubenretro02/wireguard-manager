# WireGuard Manager - TODOs

## Problemas identificados por el usuario

### 1. ✅ Las reglas NAT no tienen comentario con el número de IP
- **Ubicación**: `src/app/api/wireguard/route.ts` línea 281-287
- **Problema**: Al crear reglas NAT con `createMikroTikRules`, no se incluye el campo `comment`
- **Solución aplicada**: Se agregó `comment: \`IP ${ip_number}\`` al crear la regla NAT

### 2. ✅ Las reglas NAT no muestran tráfico (parcialmente resuelto)
- **Causa identificada**: Las reglas nuevas se creaban al final de la lista NAT, pero las reglas de masquerade existentes capturaban el tráfico antes
- **Solución aplicada**:
  - Ahora el sistema detecta automáticamente si existe una regla masquerade
  - Las nuevas reglas se crean ANTES de la regla masquerade usando `place-before`
  - Esto asegura que las reglas específicas se procesen antes que las genéricas

## Tareas

- [x] Agregar comentario a las reglas NAT al crearlas (`comment: \`IP ${ip_number}\``)
- [x] Detectar reglas masquerade existentes
- [x] Crear reglas NAT en la posición correcta (antes de masquerade)
- [ ] **(Opcional)** Agregar funcionalidad para reorganizar reglas NAT existentes

## Notas importantes

### ¿Por qué las reglas NAT no tenían tráfico?
En MikroTik, las reglas de firewall/NAT se procesan en orden. Si tienes:
1. Regla masquerade (genérica) en posición 0
2. Tu regla src-nat específica en posición 1

La regla masquerade captura TODO el tráfico antes de que llegue a tu regla específica.

**Solución**: Las nuevas reglas ahora se crean ANTES de cualquier regla masquerade existente.

### Para reglas NAT existentes que no tienen tráfico
Si ya tienes reglas NAT creadas que no muestran tráfico, debes:
1. En Winbox o terminal de MikroTik, mover las reglas src-nat ANTES de la regla masquerade
2. O eliminar las reglas y crearlas de nuevo con el sistema (ahora se crearán en la posición correcta)
