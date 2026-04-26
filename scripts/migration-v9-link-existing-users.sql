-- Migration V9: Link existing users to their creators
-- This migration helps link users that were created before the created_by_user_id field was populated

-- IMPORTANT: Replace 'SEMIADMIN_USER_ID' with the actual user ID of the semiadmin (e.g., Leonardo)
-- You can find the user ID by running:
-- SELECT id, email FROM profiles WHERE email LIKE '%leonardo%';

-- Option 1: Link specific users to a semiadmin by email pattern
-- UPDATE profiles
-- SET created_by_user_id = 'SEMIADMIN_USER_ID'
-- WHERE created_by_user_id IS NULL
-- AND role = 'user'
-- AND email LIKE '%pattern%';

-- Option 2: Link all users without a creator to a specific semiadmin
-- UPDATE profiles
-- SET created_by_user_id = 'SEMIADMIN_USER_ID'
-- WHERE created_by_user_id IS NULL
-- AND role = 'user'
-- AND id != 'SEMIADMIN_USER_ID';

-- Example: If Leonardo's email is 'leonardo@example.com' and you want to link all users
-- that were created after a certain date to him:
--
-- First, find Leonardo's ID:
-- SELECT id FROM profiles WHERE email = 'leonardo@example.com';
--
-- Then update (replace the ID):
-- UPDATE profiles
-- SET created_by_user_id = 'uuid-of-leonardo-here'
-- WHERE created_by_user_id IS NULL
-- AND role = 'user';

-- After running this migration, the users will appear in Leonardo's "My Users" page
