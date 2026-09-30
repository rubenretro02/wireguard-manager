-- ============================================================
-- Migration v30: clientes sin Telegram (un solo tipo de cliente)
--
-- Los clientes tienen peers en varios servers y hasta ahora solo existían si
-- venían por el bot. Un cliente manual es una fila de tg_customers sin
-- telegram_id: hereda todo lo que ya existe (asignar peers, renovar, expiry,
-- endpoint con dominio, peers por cliente). Si después se une al bot se le
-- vincula el telegram_id, sin migrar nada.
--
-- UNIQUE(telegram_id) admite varios NULL en Postgres, así que no hace falta
-- tocar el índice.
-- ============================================================

ALTER TABLE tg_customers ALTER COLUMN telegram_id DROP NOT NULL;

ALTER TABLE tg_customers ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'telegram'
  CHECK (source IN ('telegram', 'manual'));
ALTER TABLE tg_customers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE tg_customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE tg_customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE tg_customers ADD COLUMN IF NOT EXISTS created_by_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_tg_customers_source ON tg_customers (source);
