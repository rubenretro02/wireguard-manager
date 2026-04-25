-- Add max_connections column to socks5_proxies
ALTER TABLE socks5_proxies
ADD COLUMN IF NOT EXISTS max_connections INTEGER DEFAULT 0;

-- 0 means unlimited
COMMENT ON COLUMN socks5_proxies.max_connections IS 'Maximum simultaneous connections. 0 = unlimited';
