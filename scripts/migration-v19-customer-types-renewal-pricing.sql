-- ============================================================
-- Migration v19: customer types + per-peer renewal pricing
--
-- customer_type:
--   'client' (default) — sees the full store (buy, prices, payments)
--   'agent'            — free users; the Mini App shows ONLY their peers
--                        (status/config/time left), no store, no prices
--
-- Per-peer renewal pricing (for peers assigned from the dashboard):
--   renewal_price_usd + renewal_duration_days — if set, the customer
--   renews THIS peer at this price with Cryptomus, independent of the
--   store plans. These peers are never sold as new from the store.
-- ============================================================

ALTER TABLE tg_customers
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'client'
    CHECK (customer_type IN ('client','agent'));

ALTER TABLE tg_customer_peers
  ADD COLUMN IF NOT EXISTS renewal_price_usd NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS renewal_duration_days INTEGER;
