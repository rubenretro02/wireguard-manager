-- ============================================================
-- Migration v23: Backup de interfaces WireGuard (llaves del server)
--
-- La private key de cada interface (wg0, wg1, ...) solo vivía en
-- /etc/wireguard/<iface>.conf del servidor: si el server se formatea, se
-- pierde y TODOS los clientes tienen que re-descargar su config.
-- Esta tabla la respalda en Supabase junto al listen port, la public key
-- derivada y las Address de la interface.
--
-- La clave única es (host, interface_name): varias filas de `routers` pueden
-- apuntar al mismo host (workflow "un router config por interface"), pero la
-- interface física es una sola.
-- ============================================================

CREATE TABLE IF NOT EXISTS wg_interfaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    router_id UUID REFERENCES routers(id) ON DELETE SET NULL,
    host TEXT NOT NULL,
    interface_name TEXT NOT NULL,
    listen_port INTEGER,
    private_key TEXT,
    public_key TEXT,
    address TEXT,
    running BOOLEAN NOT NULL DEFAULT false,
    peer_count INTEGER,
    source TEXT NOT NULL DEFAULT 'sync' CHECK (source IN ('sync', 'created')),
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (host, interface_name)
);

CREATE INDEX IF NOT EXISTS idx_wg_interfaces_router ON wg_interfaces (router_id);

-- RLS: solo admins con el anon key. La app usa service role (bypass RLS).
ALTER TABLE wg_interfaces ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wg_interfaces' AND policyname = 'Admins full access wg_interfaces') THEN
    CREATE POLICY "Admins full access wg_interfaces" ON wg_interfaces FOR ALL
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
