-- Migration V8: Add can_delete capability and created_by_user_id column
-- Run this in Supabase SQL Editor

-- Add created_by_user_id column to profiles table to track user hierarchy
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Create index for efficient hierarchy queries
CREATE INDEX IF NOT EXISTS idx_profiles_created_by ON profiles(created_by_user_id);

-- Update existing capabilities to include new fields
-- Note: This does not overwrite existing capabilities, just ensures the structure is valid

-- Example of how capabilities now look:
-- {
--   "can_auto_expire": true/false,       -- Can set expiration on peers
--   "can_see_all_peers": true/false,     -- Can see all peers (not just own)
--   "can_use_restricted_ips": true/false,-- Can use restricted IPs (DEPRECATED)
--   "can_see_restricted_peers": true/false, -- Can see restricted peers (DEPRECATED)
--   "can_create_users": true/false,      -- Can create new users
--   "can_manage_user_ips": true/false,   -- Can manage IP access for users they created
--   "can_delete": true/false             -- Can delete peers and users
-- }

-- Grant admins full capabilities including new ones
UPDATE profiles
SET capabilities = jsonb_set(
  jsonb_set(
    jsonb_set(
      COALESCE(capabilities, '{}'::jsonb),
      '{can_create_users}', 'true'::jsonb
    ),
    '{can_manage_user_ips}', 'true'::jsonb
  ),
  '{can_delete}', 'true'::jsonb
)
WHERE role = 'admin';

-- Ensure all regular users have the new capability fields initialized (as false if not set)
-- This doesn't overwrite existing true values
UPDATE profiles
SET capabilities =
  CASE
    WHEN NOT (capabilities ? 'can_create_users') THEN
      jsonb_set(COALESCE(capabilities, '{}'::jsonb), '{can_create_users}', 'false'::jsonb)
    ELSE capabilities
  END
WHERE role != 'admin';

UPDATE profiles
SET capabilities =
  CASE
    WHEN NOT (capabilities ? 'can_delete') THEN
      jsonb_set(COALESCE(capabilities, '{}'::jsonb), '{can_delete}', 'false'::jsonb)
    ELSE capabilities
  END
WHERE role != 'admin';

UPDATE profiles
SET capabilities =
  CASE
    WHEN NOT (capabilities ? 'can_manage_user_ips') THEN
      jsonb_set(COALESCE(capabilities, '{}'::jsonb), '{can_manage_user_ips}', 'false'::jsonb)
    ELSE capabilities
  END
WHERE role != 'admin';
