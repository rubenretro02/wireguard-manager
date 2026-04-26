-- Activity Logs Table
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  router_id UUID REFERENCES routers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255),
  entity_name VARCHAR(255),
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_router_id ON activity_logs(router_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);

-- Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can see all logs
CREATE POLICY "Admins can view all activity logs" ON activity_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Policy: Users can see logs for routers they have access to
CREATE POLICY "Users can view their router activity logs" ON activity_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_routers
      WHERE user_routers.user_id = auth.uid()
      AND user_routers.router_id = activity_logs.router_id
    )
  );

-- Policy: Authenticated users can insert logs
CREATE POLICY "Authenticated users can insert activity logs" ON activity_logs
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Comments
COMMENT ON TABLE activity_logs IS 'Stores all activity/audit logs for the system';
COMMENT ON COLUMN activity_logs.action IS 'Action type: create, update, delete, enable, disable, connect, disconnect';
COMMENT ON COLUMN activity_logs.entity_type IS 'Entity type: peer, public_ip, router, user, interface';
COMMENT ON COLUMN activity_logs.details IS 'Additional JSON details about the action';
