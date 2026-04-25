-- =============================================
-- SOCKS5 PROXIES - Full Features Migration
-- =============================================

-- Add name field for internal record
ALTER TABLE socks5_proxies
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- Add expiration/timer fields
ALTER TABLE socks5_proxies
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE socks5_proxies
ADD COLUMN IF NOT EXISTS scheduled_enable TIMESTAMP WITH TIME ZONE;

-- Add traffic tracking
ALTER TABLE socks5_proxies
ADD COLUMN IF NOT EXISTS bytes_sent BIGINT DEFAULT 0;

ALTER TABLE socks5_proxies
ADD COLUMN IF NOT EXISTS bytes_received BIGINT DEFAULT 0;

ALTER TABLE socks5_proxies
ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMP WITH TIME ZONE;

-- Add max_connections if not exists (from previous migration)
ALTER TABLE socks5_proxies
ADD COLUMN IF NOT EXISTS max_connections INTEGER DEFAULT 0;

-- Create index for expiration queries
CREATE INDEX IF NOT EXISTS idx_socks5_proxies_expires_at ON socks5_proxies(expires_at);
CREATE INDEX IF NOT EXISTS idx_socks5_proxies_scheduled_enable ON socks5_proxies(scheduled_enable);

-- Comments
COMMENT ON COLUMN socks5_proxies.name IS 'Internal name/label for the proxy';
COMMENT ON COLUMN socks5_proxies.expires_at IS 'Auto-disable at this time';
COMMENT ON COLUMN socks5_proxies.scheduled_enable IS 'Auto-enable at this time';
COMMENT ON COLUMN socks5_proxies.bytes_sent IS 'Total bytes uploaded through proxy';
COMMENT ON COLUMN socks5_proxies.bytes_received IS 'Total bytes downloaded through proxy';
COMMENT ON COLUMN socks5_proxies.last_connected_at IS 'Last time proxy was used';
