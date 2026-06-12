-- ============================================================
-- Migration v17: IPs for sale (Telegram store)
-- Solo las IPs marcadas for_sale = true se usan para el
-- aprovisionamiento automático de la Mini App. El resto quedan
-- reservadas (uso propio / clientes con IP dedicada).
-- ============================================================

ALTER TABLE public_ips
  ADD COLUMN IF NOT EXISTS for_sale BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_public_ips_for_sale
  ON public_ips(router_id, for_sale) WHERE for_sale = true;
