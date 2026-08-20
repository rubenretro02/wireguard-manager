-- Migration V24: un solo timer de expiración (dashboard + tienda Telegram)
-- Run this in Supabase SQL Editor
--
-- Contexto: había DOS relojes independientes que nunca se hablaban:
--   * peer_metadata.expires_at + auto_disable_enabled  -> el del dashboard
--   * tg_customer_peers.expires_at                     -> el de la tienda TG
-- El extend de TG no tocaba peer_metadata, así que el auto-disable del dashboard
-- volvía a apagar el peer al minuto. A partir de v24 la app escribe las dos con
-- setUnifiedExpiry() (src/lib/peer-expiry.ts); este script arregla lo ya divergido.
--
-- OJO: el join es SOLO por peer_public_key. peer_metadata.router_id es TEXT y
-- tg_customer_peers.router_id es UUID, y en el workflow router-per-interface un
-- mismo peer puede vivir bajo varias filas de `routers`.

-- ---------------------------------------------------------------------------
-- 1. Columnas que la app escribe desde siempre pero nunca se migraron
--    (src/lib/types.ts las declara; ningún script las creaba).
-- ---------------------------------------------------------------------------
ALTER TABLE peer_metadata ADD COLUMN IF NOT EXISTS expiration_value INTEGER;
ALTER TABLE peer_metadata ADD COLUMN IF NOT EXISTS expiration_unit TEXT;

-- ---------------------------------------------------------------------------
-- 2. Backfill: gana la fecha mayor. Los 3 pasos van EN ESTE ORDEN.
-- ---------------------------------------------------------------------------

-- 2a. TG sin timer (expires_at NULL, v21) => sin timer en el dashboard tampoco.
--     Esta regla gana sobre GREATEST: "sin timer" significa sin timer.
UPDATE peer_metadata pm
SET expires_at = NULL,
    auto_disable_enabled = false,
    expiration_hours = NULL,
    expiration_value = NULL,
    expiration_unit = NULL
FROM tg_customer_peers tcp
WHERE tcp.peer_public_key = pm.peer_public_key
  AND tcp.expires_at IS NULL
  AND (pm.expires_at IS NOT NULL OR pm.auto_disable_enabled);

-- 2b. Ambos con fecha => tg_customer_peers se queda con el máximo.
UPDATE tg_customer_peers tcp
SET expires_at = GREATEST(tcp.expires_at, pm.expires_at)
FROM peer_metadata pm
WHERE pm.peer_public_key = tcp.peer_public_key
  AND tcp.expires_at IS NOT NULL
  AND pm.expires_at IS NOT NULL
  AND pm.expires_at > tcp.expires_at;

-- 2c. Espejar el máximo (ya en tcp) de vuelta al dashboard.
UPDATE peer_metadata pm
SET expires_at = tcp.expires_at,
    auto_disable_enabled = true
FROM tg_customer_peers tcp
WHERE tcp.peer_public_key = pm.peer_public_key
  AND tcp.expires_at IS NOT NULL
  AND (pm.expires_at IS DISTINCT FROM tcp.expires_at OR NOT pm.auto_disable_enabled);

-- ---------------------------------------------------------------------------
-- 3. Verificación: debe devolver 0 filas.
-- ---------------------------------------------------------------------------
-- SELECT tcp.peer_name, tcp.expires_at AS tg, pm.expires_at AS dash, pm.auto_disable_enabled
-- FROM tg_customer_peers tcp
-- JOIN peer_metadata pm ON pm.peer_public_key = tcp.peer_public_key
-- WHERE tcp.expires_at IS DISTINCT FROM pm.expires_at
--    OR (tcp.expires_at IS NULL AND pm.auto_disable_enabled);

-- ---------------------------------------------------------------------------
-- 4. Los peers que el bug dejó apagados con fecha futura NO se reviven acá
--    (SQL no puede tocar el servidor WireGuard). De eso se encarga el paso de
--    auto-sanación de /api/cron/enforce-peer-expiry:
--       tg_customer_peers.status = 'expired' AND expires_at > now() -> reactivar.
-- ---------------------------------------------------------------------------
