-- ============================================================
-- Migration v34: slug del endpoint por tenant (white-label)
--
-- El slug de un server (routers.endpoint_slug) lo comparten todos los tenants:
-- <slug>.<dominio de cada uno>. Si un semi-admin lo renombra rompe el DNS de
-- los demás. Cada perfil guarda ahora sus propios nombres por router
-- ({ "<router_id>": "miami", ... }); el del router queda como default.
-- Se edita con el lápiz en /profile → "DNS records to create".
--
-- Aplicada en producción el 2026-10-02 vía Management API.
-- ============================================================

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS endpoint_slugs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profiles.endpoint_slugs IS 'DNS label por router para el endpoint white-label de este tenant: {"<router_id>": "slug"}';

NOTIFY pgrst, 'reload schema';
