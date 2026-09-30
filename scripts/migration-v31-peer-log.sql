-- ============================================================
-- Migration v31: historial por peer (log + sesiones de conexión)
--
-- 1) activity_logs.peer_public_key: los eventos de peers (create / enable /
--    disable / renew / delete / assign) ya se registran, pero entity_id es
--    inconsistente (id de linux_peers, .id de MikroTik, prefijo de llave…).
--    Indexar por public key permite ver "todo lo que le pasó a este peer".
--
-- 2) peer_sessions: WireGuard no emite eventos de conexión. El cron
--    /api/cron/peer-presence lee los handshakes de todos los servers cada
--    1–2 min y abre/cierra sesiones cuando un peer pasa online/offline.
--    Una sesión abierta (ended_at NULL) = el peer está online ahora.
-- ============================================================

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS peer_public_key TEXT;
CREATE INDEX IF NOT EXISTS idx_activity_logs_peer_key
  ON activity_logs (peer_public_key, created_at DESC) WHERE peer_public_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS peer_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    router_id TEXT NOT NULL,
    peer_public_key TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    last_handshake_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_ip TEXT,
    rx_bytes BIGINT NOT NULL DEFAULT 0,
    tx_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_peer_sessions_peer ON peer_sessions (peer_public_key, started_at DESC);
-- A lo sumo una sesión abierta por peer y server
CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_sessions_open
  ON peer_sessions (router_id, peer_public_key) WHERE ended_at IS NULL;

ALTER TABLE peer_sessions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peer_sessions' AND policyname = 'Authenticated read peer_sessions') THEN
    CREATE POLICY "Authenticated read peer_sessions" ON peer_sessions FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
