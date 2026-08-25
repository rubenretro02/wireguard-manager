-- ============================================================
-- Migration v29: endpoint con dominio también en la tienda de Telegram
--
-- La Mini App arma el .conf desde tg_customer_peers sin tocar el servidor, así
-- que el Endpoint salía siempre como IP. Esta columna guarda el host resuelto
-- (<slug>.<dominio del dueño>) al aprovisionar, asignar o rotar llaves.
-- NULL = usar public_ip, como hasta ahora.
-- ============================================================

ALTER TABLE tg_customer_peers ADD COLUMN IF NOT EXISTS endpoint_host TEXT;

COMMENT ON COLUMN tg_customer_peers.endpoint_host IS 'Host del Endpoint del cliente (white-label). NULL = usar public_ip.';
