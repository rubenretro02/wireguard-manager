-- ============================================================
-- Migration v21: expiración opcional en peers de customers
-- Peers asignados desde el dashboard que no tienen timer ni fueron
-- comprados en el store pueden no tener expiración (expires_at NULL =
-- sin timer, la Mini App no muestra fecha y el cron no los toca).
-- ============================================================

ALTER TABLE tg_customer_peers ALTER COLUMN expires_at DROP NOT NULL;
