-- ============================================================
-- Migration v36: nombre propio del cliente (tg_customers.name)
--
-- first_name / last_name son de TELEGRAM: tg-auth los reescribe en cada login
-- de la Mini App y linkTelegramToCustomer los pisa al vincular. Los clientes
-- manuales guardaban su nombre ahí, así que al vincular (y abrir la app) el
-- nombre que puso el admin desaparecía ("fijurno" → "T S" / @TXSMVRT).
-- `name` es la etiqueta del panel: la pone el admin, nunca la toca Telegram.
--
-- Aplicada en producción el 2026-10-07 vía Management API.
-- ============================================================

ALTER TABLE tg_customers ADD COLUMN IF NOT EXISTS name TEXT;
COMMENT ON COLUMN tg_customers.name IS 'Etiqueta del panel para el cliente; independiente de first_name/last_name (Telegram)';

-- Manuales sin vincular: el nombre que escribió el admin está en first/last
UPDATE tg_customers
   SET name = NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '')
 WHERE name IS NULL AND source = 'manual' AND telegram_id IS NULL;

NOTIFY pgrst, 'reload schema';
