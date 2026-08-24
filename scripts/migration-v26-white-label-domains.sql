-- ============================================================
-- Migration v26: White-label / multi-tenant domains
--
-- Cada semi-admin (ej. homevpn) puede tener:
--   * panel_domain    -> entra al manager por su propio dominio (vpn.homevpn.com)
--   * endpoint_domain -> dominio BASE de los peers que crea (zone.homevpn.com)
--   * brand_name      -> nombre que se muestra en su panel
--
-- El endpoint final de un peer es <router.endpoint_slug>.<endpoint_domain>
-- (ej. tx.zone.homevpn.com) porque un solo nombre DNS no puede resolver a
-- varios servidores: cada server necesita su propio registro A.
--
-- Resolución del dominio de un peer (ver src/lib/endpoint-domain.ts):
--   1. endpoint_domain del usuario que creó el peer
--   2. endpoint_domain de quien creó a ese usuario (cadena de padres)
--   3. routers.endpoint_domain (default global del server)
--   4. NULL -> se sigue usando la IP pública, como hasta ahora
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS endpoint_domain TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS panel_domain TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS brand_name TEXT;

-- Un dominio de panel no puede repetirse entre tenants (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_panel_domain
  ON profiles (lower(panel_domain)) WHERE panel_domain IS NOT NULL;

-- Prefijo por servidor (tx, oh, fl...) + dominio base por defecto del servidor
ALTER TABLE routers ADD COLUMN IF NOT EXISTS endpoint_slug TEXT;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS endpoint_domain TEXT;

COMMENT ON COLUMN routers.endpoint_slug IS 'Prefijo DNS del server dentro del dominio del tenant: <slug>.<endpoint_domain>';
COMMENT ON COLUMN routers.endpoint_domain IS 'Dominio base por defecto cuando el creador del peer no tiene uno propio';
