-- ============================================================
-- Migration v32: vincular un cliente manual con Telegram por link
--
-- El admin genera un link (t.me/<bot>?start=clink_<token>) desde la página
-- del cliente y se lo manda. Cuando el cliente lo abre, el webhook vincula su
-- telegram_id a esa fila de tg_customers: pasa a ver sus peers en la Mini App
-- sin que haya que reasignar nada. Token de un solo uso, 7 días de vida.
-- ============================================================

CREATE TABLE IF NOT EXISTS tg_customer_link_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES tg_customers(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_customer_link_tokens_customer ON tg_customer_link_tokens (customer_id);

-- Solo la app (service role) toca esta tabla
ALTER TABLE tg_customer_link_tokens ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tg_customer_link_tokens' AND policyname = 'Admins full access customer link tokens') THEN
    CREATE POLICY "Admins full access customer link tokens" ON tg_customer_link_tokens FOR ALL
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
