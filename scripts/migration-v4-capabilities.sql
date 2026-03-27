-- Migration V4: Add user capabilities and peer metadata enhancements
-- Run this in Supabase SQL Editor

-- Add capabilities column to profiles (JSONB for flexibility)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}';

-- Update peer_metadata table with expiration fields
ALTER TABLE peer_metadata ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE peer_metadata ADD COLUMN IF NOT EXISTS auto_disable_enabled BOOLEAN DEFAULT false;
ALTER TABLE peer_metadata ADD COLUMN IF NOT EXISTS expiration_hours INTEGER;
ALTER TABLE peer_metadata ADD COLUMN IF NOT EXISTS last_status_check TIMESTAMPTZ;

-- Add update policy for peer_metadata
CREATE POLICY "Authenticated users can update peer metadata"
  ON peer_metadata FOR UPDATE
  USING (true);

-- Create index for expiration checks
CREATE INDEX IF NOT EXISTS idx_peer_metadata_expires ON peer_metadata(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_peer_metadata_created_by ON peer_metadata(created_by_user_id);

-- Example capabilities structure:
-- {
--   "can_auto_expire": true,      -- Can set expiration on peers
--   "can_see_all_peers": false,   -- Can see all peers (not just own)
--   "can_use_restricted_ips": false -- Can use restricted IPs
-- }

-- Set default capabilities for existing users
UPDATE profiles
SET capabilities = '{"can_auto_expire": false, "can_see_all_peers": false, "can_use_restricted_ips": false}'::jsonb
WHERE capabilities IS NULL OR capabilities = '{}'::jsonb;

-- For admins, set all capabilities to true
UPDATE profiles
SET capabilities = '{"can_auto_expire": true, "can_see_all_peers": true, "can_use_restricted_ips": true}'::jsonb
WHERE role = 'admin';
