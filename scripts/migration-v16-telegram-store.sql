-- ============================================================
-- Migration v16: Telegram Mini App store
-- Customers (Telegram users), Plans, Customer Peers, Payments (Cryptomus)
-- All access from the app goes through the SERVICE ROLE (server-side).
-- RLS is enabled with admin-only policies for the dashboard.
-- ============================================================

-- Telegram end-customers (auto-registered when they open the Mini App)
CREATE TABLE IF NOT EXISTS tg_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    photo_url TEXT,
    language_code TEXT,
    is_banned BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Plans the admin sells (each plan is tied to a router/server)
CREATE TABLE IF NOT EXISTS tg_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price_usd NUMERIC(10,2) NOT NULL,
    duration_days INTEGER NOT NULL,
    router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    -- Optional: pin the plan to one public IP. NULL = auto-pick an enabled,
    -- non-restricted public IP of the router.
    public_ip_id UUID REFERENCES public_ips(id) ON DELETE SET NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Peers owned by Telegram customers (mirrors a row in linux_peers)
CREATE TABLE IF NOT EXISTS tg_customer_peers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES tg_customers(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES tg_plans(id) ON DELETE SET NULL,
    router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    linux_peer_id UUID, -- linux_peers.id (soft reference, table may prune)
    peer_name TEXT NOT NULL,
    peer_public_key TEXT NOT NULL,
    peer_private_key TEXT NOT NULL,
    allowed_address TEXT NOT NULL,        -- ej: 10.10.200.5/32
    wg_interface TEXT NOT NULL,           -- interface efectiva donde vive el peer
    public_ip TEXT NOT NULL,              -- IP pública de salida / endpoint host
    server_public_key TEXT NOT NULL,
    listen_port INTEGER NOT NULL,
    dns TEXT NOT NULL DEFAULT '8.8.8.8',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disabled')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_customer_peers_customer ON tg_customer_peers(customer_id);
CREATE INDEX IF NOT EXISTS idx_tg_customer_peers_expiry ON tg_customer_peers(status, expires_at);

-- Cryptomus payments (purchase = new peer, renewal = extend existing peer)
CREATE TABLE IF NOT EXISTS tg_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES tg_customers(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES tg_plans(id) ON DELETE SET NULL,
    customer_peer_id UUID REFERENCES tg_customer_peers(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('purchase','renewal')),
    order_id TEXT NOT NULL UNIQUE,        -- nuestro id de orden enviado a Cryptomus
    cryptomus_uuid TEXT,                  -- uuid de invoice en Cryptomus
    amount_usd NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','failed','cancelled','expired')),
    payment_url TEXT,
    fulfilled_at TIMESTAMPTZ,             -- cuándo se aprovisionó/renovó (idempotencia)
    paid_at TIMESTAMPTZ,
    raw JSONB,                            -- último payload del webhook
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_payments_customer ON tg_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_tg_payments_status ON tg_payments(status);

-- RLS: solo admins del dashboard pueden tocar estas tablas con el anon key.
-- La miniapp y los webhooks usan el service role key (bypass RLS).
ALTER TABLE tg_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_customer_peers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tg_customers' AND policyname = 'Admins full access tg_customers') THEN
    CREATE POLICY "Admins full access tg_customers" ON tg_customers FOR ALL
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tg_plans' AND policyname = 'Admins full access tg_plans') THEN
    CREATE POLICY "Admins full access tg_plans" ON tg_plans FOR ALL
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tg_customer_peers' AND policyname = 'Admins full access tg_customer_peers') THEN
    CREATE POLICY "Admins full access tg_customer_peers" ON tg_customer_peers FOR ALL
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tg_payments' AND policyname = 'Admins full access tg_payments') THEN
    CREATE POLICY "Admins full access tg_payments" ON tg_payments FOR ALL
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
