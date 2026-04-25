-- Migration V5: Fix RLS policies for admin capability updates
-- Run this in Supabase SQL Editor
-- NOTE: This requires the SUPABASE_SERVICE_ROLE_KEY to be set in your environment for full functionality

-- Drop existing update policy if exists (to recreate with correct permissions)
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

-- Create policy allowing users to update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Create policy allowing admins to update any profile
-- Note: This checks the role from the requesting user's profile
CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Ensure capabilities column has proper default
ALTER TABLE profiles ALTER COLUMN capabilities SET DEFAULT '{"can_auto_expire": false, "can_see_all_peers": false, "can_use_restricted_ips": false, "can_see_restricted_peers": false}'::jsonb;

-- Update any NULL or empty capabilities to defaults
UPDATE profiles
SET capabilities = '{"can_auto_expire": false, "can_see_all_peers": false, "can_use_restricted_ips": false, "can_see_restricted_peers": false}'::jsonb
WHERE capabilities IS NULL;

-- Add new capability to existing users who don't have it
UPDATE profiles
SET capabilities = capabilities || '{"can_see_restricted_peers": false}'::jsonb
WHERE capabilities IS NOT NULL AND NOT capabilities ? 'can_see_restricted_peers';

-- Make sure admins have full capabilities
UPDATE profiles
SET capabilities = jsonb_set(
  COALESCE(capabilities, '{}'::jsonb),
  '{can_auto_expire}',
  'true'::jsonb
)
WHERE role = 'admin';

UPDATE profiles
SET capabilities = jsonb_set(
  COALESCE(capabilities, '{}'::jsonb),
  '{can_see_all_peers}',
  'true'::jsonb
)
WHERE role = 'admin';

UPDATE profiles
SET capabilities = jsonb_set(
  COALESCE(capabilities, '{}'::jsonb),
  '{can_use_restricted_ips}',
  'true'::jsonb
)
WHERE role = 'admin';

-- Alternative: If the above doesn't work due to RLS, run this with service_role:
-- Use the Supabase API with service_role key to update capabilities
-- This bypasses RLS completely
