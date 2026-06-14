-- ============================================================
-- Migration v22: Login de admin/semi-admin desde Telegram
-- Vincula un perfil del dashboard (profiles) a un usuario de Telegram
-- y permite acuñar una sesión de Supabase desde el bot (link de un solo
-- uso o Mini App). Reusa el bot de agents (@Wireguardvpnmanagerbot).
-- Todo el acceso de la app es server-side con SERVICE ROLE.
-- ============================================================

-- 1) Vínculo Telegram <-> profile (un Telegram por perfil)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;

-- 2) Tokens de un solo uso para vincular (purpose='link') e iniciar sesión
--    (purpose='login'). TTL corto, single-use (used_at). La app los crea y
--    consume con el service role.
CREATE TABLE IF NOT EXISTS admin_tg_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL CHECK (purpose IN ('link', 'login')),
    -- 'link': perfil que generó el token desde /profile (ya autenticado).
    -- 'login': perfil ya vinculado para el que se emite la sesión.
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_tg_tokens_token ON admin_tg_tokens (token);
CREATE INDEX IF NOT EXISTS idx_admin_tg_tokens_expires_at ON admin_tg_tokens (expires_at);

-- RLS: solo admins del dashboard con el anon key. La app usa service role
-- (bypass RLS), igual que tg_customers/tg_payments (ver v16).
ALTER TABLE admin_tg_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_tg_tokens' AND policyname = 'Admins full access admin_tg_tokens') THEN
    CREATE POLICY "Admins full access admin_tg_tokens" ON admin_tg_tokens FOR ALL
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
