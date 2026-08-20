-- Migration V25: reparar activity_logs + página de Logs
-- Run this in Supabase SQL Editor
--
-- PROBLEMA: la tabla `activity_logs` en la DB quedó con un esquema VIEJO
-- (user_email, ip_number, public_ip) mientras `logActivity()` inserta el esquema
-- nuevo (entity_type, entity_id, entity_name, ip_address). Como
-- `scripts/migration-activity-logs.sql` usa CREATE TABLE IF NOT EXISTS, nunca
-- corrigió nada: la tabla ya existía. Resultado -> TODOS los logActivity()
-- fallaban en silencio (logActivity atrapa el error y solo hace console.error).
-- Medido el 2026-08-20: activity_logs tenía 0 filas.

-- ---------------------------------------------------------------------------
-- 1. Columnas que la app escribe y no existían
-- ---------------------------------------------------------------------------
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS entity_id   VARCHAR(255);
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS entity_name VARCHAR(255);
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS ip_address  VARCHAR(45);

-- Nullable a propósito: los eventos de sistema (cron, webhooks) no tienen
-- entity_type ni usuario. Poner NOT NULL volvería a romper los inserts.

-- ---------------------------------------------------------------------------
-- 2. Índices para la página de Logs (orden por fecha + filtros)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activity_logs_created  ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_router   ON activity_logs (router_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user     ON activity_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action   ON activity_logs (action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity   ON activity_logs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 3. Verificación: debe devolver las 4 columnas nuevas
-- ---------------------------------------------------------------------------
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'activity_logs'
--   AND column_name IN ('entity_type','entity_id','entity_name','ip_address');
--
-- Después de correrla, cualquier enable/disable/renew debe dejar fila:
-- SELECT created_at, action, entity_type, entity_name, details
-- FROM activity_logs ORDER BY created_at DESC LIMIT 20;
