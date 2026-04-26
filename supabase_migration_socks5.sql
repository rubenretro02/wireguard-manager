-- =============================================
-- SOCKS5 PROXIES TABLE
-- =============================================

-- Create socks5_proxies table
CREATE TABLE IF NOT EXISTS socks5_proxies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  username VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  public_ip VARCHAR(45) NOT NULL,
  port INTEGER NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint: username per router
  UNIQUE(router_id, username),
  -- Unique constraint: port per router
  UNIQUE(router_id, port)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_socks5_proxies_router_id ON socks5_proxies(router_id);
CREATE INDEX IF NOT EXISTS idx_socks5_proxies_public_ip ON socks5_proxies(public_ip);
CREATE INDEX IF NOT EXISTS idx_socks5_proxies_enabled ON socks5_proxies(enabled);

-- Enable RLS
ALTER TABLE socks5_proxies ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Admins can do everything
CREATE POLICY "Admins can manage socks5_proxies" ON socks5_proxies
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Users can view proxies for routers they have access to
CREATE POLICY "Users can view their socks5_proxies" ON socks5_proxies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_routers
      WHERE user_routers.router_id = socks5_proxies.router_id
      AND user_routers.user_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_socks5_proxies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_socks5_proxies_updated_at
  BEFORE UPDATE ON socks5_proxies
  FOR EACH ROW
  EXECUTE FUNCTION update_socks5_proxies_updated_at();

-- =============================================
-- GRANT PERMISSIONS
-- =============================================
GRANT ALL ON socks5_proxies TO authenticated;
