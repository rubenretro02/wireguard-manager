-- ============================================================
-- Migration v28: API keys por usuario (API pública v1)
--
-- Cada admin o semi-admin puede emitir sus propias keys para manejar su cuenta
-- desde afuera. La key NO se guarda: solo su SHA-256. El prefijo se guarda
-- aparte para poder mostrarla en la UI ("wgm_live_ab12cd…").
--
-- La key no lleva permisos propios: la request corre con los permisos exactos
-- del usuario dueño (role + capabilities), así nadie puede hacer por API algo
-- que no pueda hacer en el panel.
-- ============================================================

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);

-- RLS: cada uno ve solo sus keys; los admins ven todas. La app usa service role.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'Own api keys') THEN
    CREATE POLICY "Own api keys" ON api_keys FOR ALL
      USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
