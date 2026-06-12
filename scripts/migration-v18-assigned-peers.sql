-- ============================================================
-- Migration v18: assign existing peers to Telegram customers
-- peer_private_key becomes nullable: peers that already existed on the
-- router can be assigned to a customer without knowing their private key
-- (the customer can rotate keys from the Mini App to get a full config).
-- ============================================================

ALTER TABLE tg_customer_peers ALTER COLUMN peer_private_key DROP NOT NULL;
