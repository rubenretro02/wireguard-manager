-- =====================================================
-- MIGRATION: User IP Access System
-- =====================================================

-- 1. Create user_ip_access table
CREATE TABLE IF NOT EXISTS user_ip_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  ip_id UUID NOT NULL REFERENCES public_ips(id) ON DELETE CASCADE,
  can_use BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint: one record per user-router-ip combination
  UNIQUE(user_id, router_id, ip_id)
);

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_ip_access_user_id ON user_ip_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ip_access_router_id ON user_ip_access(router_id);
CREATE INDEX IF NOT EXISTS idx_user_ip_access_ip_id ON user_ip_access(ip_id);

-- 3. Enable RLS
ALTER TABLE user_ip_access ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Admins can do everything
CREATE POLICY "Admins can manage user_ip_access" ON user_ip_access
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Users with can_manage_user_ips capability can manage access for users they created
CREATE POLICY "Users with capability can manage their users ip access" ON user_ip_access
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles manager
      WHERE manager.id = auth.uid()
      AND (manager.capabilities->>'can_manage_user_ips')::boolean = true
      AND EXISTS (
        SELECT 1 FROM profiles target
        WHERE target.id = user_ip_access.user_id
        AND target.created_by_user_id = auth.uid()
      )
    )
  );

-- Users can read their own access
CREATE POLICY "Users can view own ip access" ON user_ip_access
  FOR SELECT
  USING (user_id = auth.uid());

-- 5. Add created_by_user_id to profiles if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'created_by_user_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN created_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 6. Update capabilities JSONB to include new capabilities
-- This is optional - capabilities are added dynamically via the app
COMMENT ON TABLE user_ip_access IS 'Manages which IPs each user can use per router';

