# WireGuard Manager - Proyecto con Supabase

## Completado
- [x] Crear proyecto nuevo con Next.js + shadcn/ui
- [x] Configurar Supabase (tablas profiles y routers)
- [x] Implementar autenticación con Supabase Auth
- [x] Crear página de login/registro
- [x] Crear dashboard para gestionar peers WireGuard
- [x] Crear panel de admin para routers y usuarios
- [x] API routes para routers y WireGuard
- [x] Modo demo para pruebas sin router real
- [x] Row Level Security (RLS) configurado
- [x] Agregar soporte para API clásica (puerto 8728)
- [x] Agregar columna connection_type a tabla routers
- [x] UI para seleccionar tipo de conexión al agregar router
- [x] Generación automática de claves WireGuard
- [x] Barra de búsqueda para filtrar peers
- [x] Sugerencias de IP disponibles al crear peers
- [x] Eliminar registro público (solo admin crea usuarios)

## En Progreso
- [x] Aumentar timeout de conexión a 60 segundos (era 15)
- [x] Agregar logs detallados para debugging de creación de peers

## Características
- **Usuarios persistentes** en Supabase (ya no se pierden al reiniciar)
- **Routers persistentes** en base de datos PostgreSQL
- **Roles de usuario**: admin y user
- **Autenticación segura** con Supabase Auth
- **REST API** para MikroTik RouterOS v7+ (puerto 443 con SSL)
- **API clásica** para MikroTik (puerto 8728 sin SSL) - RECOMENDADO
- **Timeout de 60 segundos** para operaciones en el router

## Tipos de Conexión
| Tipo | Puerto | SSL | Descripción |
|------|--------|-----|-------------|
| API | 8728 | No | Protocolo nativo de MikroTik. Funciona sin certificado. **Recomendado** |
| REST | 443 | Sí | REST API sobre HTTPS. Requiere certificado SSL en el router. |

## Pendiente
- [ ] Agregar soporte para API-SSL (puerto 8729)
- [ ] Agregar logs de actividad

## Credenciales de prueba
Para probar, el admin debe crear usuarios desde el panel de admin.
