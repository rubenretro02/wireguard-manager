-- ============================================================
-- Migration v32: cuentas StarHome (StarVPN) con slots residenciales
--
-- Un admin o semi-admin (can_create_users) pega el email + auth_token de su
-- cuenta StarHome en /profile. La app crea una fila en `routers` con
-- connection_type = 'starhome' (el "server" que se ve en los selectores) y los
-- slots de la cuenta salen como peers en el Dashboard y como proxies SOCKS5
-- (proxy.starzone.io:puerto) en /socks5. Borrar el router borra todo en cascada.
--
-- El token es de la CUENTA, no del slot (verificado 2026-09-30: el dashboard
-- de StarVPN arma exactamente el mismo comando para los slots 1, 2 y 3). Se
-- guarda en claro, igual que routers.password.
-- ============================================================

-- routers.connection_type tiene un CHECK (creado a mano en Supabase, no está en
-- los scripts) que no admite 'starhome' → "violates check constraint
-- routers_connection_type_check" al conectar. Se recrea con el valor nuevo.
ALTER TABLE routers DROP CONSTRAINT IF EXISTS routers_connection_type_check;
ALTER TABLE routers ADD CONSTRAINT routers_connection_type_check
    CHECK (connection_type IN ('rest', 'rest-8443', 'api', 'api-ssl', 'linux-ssh', 'starhome'));

CREATE TABLE IF NOT EXISTS starhome_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    router_id UUID NOT NULL UNIQUE REFERENCES routers(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    email TEXT NOT NULL,
    auth_token TEXT NOT NULL,
    proxy_host TEXT NOT NULL DEFAULT 'proxy.starzone.io',
    -- Lo que devuelve refresh_data a nivel cuenta
    package TEXT,
    status TEXT,
    next_due_date DATE,
    total_slots INTEGER,
    last_synced_at TIMESTAMPTZ,
    last_sync_error TEXT,
    -- PublicKey del server WireGuard de StarVPN si algún día rota (null = la
    -- constante STARHOME_WG_SERVER_PUBLIC_KEY del código). Se edita en /profile.
    wg_server_public_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_user_id, email)
);

-- Bases que corrieron versiones anteriores de este script: las columnas se
-- agregan aparte porque CREATE TABLE IF NOT EXISTS no las añade.
ALTER TABLE starhome_accounts
    ADD COLUMN IF NOT EXISTS router_id UUID UNIQUE REFERENCES routers(id) ON DELETE CASCADE;
ALTER TABLE starhome_accounts
    ADD COLUMN IF NOT EXISTS wg_server_public_key TEXT;

CREATE TABLE IF NOT EXISTS starhome_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES starhome_accounts(id) ON DELETE CASCADE,
    slot_number INTEGER NOT NULL,
    port INTEGER NOT NULL,
    -- Copia de ip_types[] de refresh_data (raw guarda la entrada completa,
    -- incluidas las llaves WireGuard que StarVPN entrega por slot)
    ip_type TEXT,
    country TEXT,
    region TEXT,
    isp TEXT,
    vpn_username TEXT,
    vpn_password TEXT,
    remaining_updates INTEGER,
    raw JSONB,
    -- Lo nuestro
    name TEXT,
    assigned_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    last_rotated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, slot_number)
);

CREATE INDEX IF NOT EXISTS idx_starhome_slots_account ON starhome_slots (account_id);
CREATE INDEX IF NOT EXISTS idx_starhome_slots_assigned ON starhome_slots (assigned_user_id);

-- RLS: el dueño y los admins ven la cuenta; los slots también los ve el usuario
-- asignado (el Sidebar lo usa para decidir si muestra el link). La app escribe
-- con service role.
ALTER TABLE starhome_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE starhome_slots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'starhome_accounts' AND policyname = 'Own starhome accounts') THEN
    CREATE POLICY "Own starhome accounts" ON starhome_accounts FOR ALL
      USING (
        owner_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'starhome_slots' AND policyname = 'Own or assigned starhome slots') THEN
    CREATE POLICY "Own or assigned starhome slots" ON starhome_slots FOR SELECT
      USING (
        assigned_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM starhome_accounts a WHERE a.id = starhome_slots.account_id AND a.owner_user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

-- PostgREST cachea el esquema: sin esto la API puede seguir diciendo
-- "Could not find the 'router_id' column ... in the schema cache" un rato.
NOTIFY pgrst, 'reload schema';
