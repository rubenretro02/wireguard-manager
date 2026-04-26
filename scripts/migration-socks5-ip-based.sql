-- =============================================
-- MIGRATION: Change SOCKS5 from port-based to IP-based
-- =============================================
-- This migration changes the unique constraint from (router_id, port)
-- to (router_id, public_ip) to support the new system where each proxy
-- listens on its own IP address with a fixed port (1080).
--
-- Before: Different ports, same host (router IP)
-- After:  Same port (1080), different hosts (each public IP)

-- Drop the old constraint (port per router)
ALTER TABLE socks5_proxies
DROP CONSTRAINT IF EXISTS socks5_proxies_router_id_port_key;

-- Add new constraint (public IP per router)
ALTER TABLE socks5_proxies
ADD CONSTRAINT socks5_proxies_router_id_public_ip_key UNIQUE (router_id, public_ip);

-- Update port column comment (optional, for documentation)
COMMENT ON COLUMN socks5_proxies.port IS 'Port is always 1080. Each proxy listens on its own public IP.';
