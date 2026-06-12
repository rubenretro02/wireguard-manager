-- ============================================================
-- Migration v20: customer display names + dedicated IP sales
--
-- display_name: nombre que VE y edita el customer ("Peer 1", "Peer 2"...).
--   El admin sigue viendo peer_name (el del sistema, ej tg-geov8-xxxx).
--
-- is_dedicated_ip (plans): el plan aprovisiona SOLO en IPs for-sale marcadas
--   sale_dedicated, y cada una de esas IPs se vende a UN solo customer.
--   Plans normales usan solo IPs for-sale shared (sale_dedicated = false).
-- ============================================================

ALTER TABLE tg_customer_peers
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE tg_plans
  ADD COLUMN IF NOT EXISTS is_dedicated_ip BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public_ips
  ADD COLUMN IF NOT EXISTS sale_dedicated BOOLEAN NOT NULL DEFAULT false;
