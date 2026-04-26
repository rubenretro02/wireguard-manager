-- =====================================================
-- WireGuard Manager - Migration V6
-- Soporte para servidores Linux vía SSH
-- =====================================================

-- Agregar campos SSH a la tabla routers
ALTER TABLE routers
ADD COLUMN IF NOT EXISTS ssh_port INTEGER DEFAULT 22,
ADD COLUMN IF NOT EXISTS ssh_key TEXT,
ADD COLUMN IF NOT EXISTS ssh_auth_method TEXT DEFAULT 'password';

-- Comentarios
COMMENT ON COLUMN routers.ssh_port IS 'Puerto SSH para conexiones Linux (default: 22)';
COMMENT ON COLUMN routers.ssh_key IS 'Clave privada SSH (para auth por clave)';
COMMENT ON COLUMN routers.ssh_auth_method IS 'Método de autenticación: password, key, both';

-- Actualizar connection_type para incluir linux-ssh
-- (No es necesario si usas TEXT, pero útil para documentación)
COMMENT ON COLUMN routers.connection_type IS 'Tipo de conexión: rest, rest-8443, api, api-ssl, linux-ssh';

-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================
