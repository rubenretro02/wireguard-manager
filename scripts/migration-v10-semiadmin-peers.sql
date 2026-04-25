-- =====================================================
-- WireGuard Manager - Migration V10
-- Allow semi-admins to see peers created by users they created
-- =====================================================

-- Drop existing SELECT policy for linux_peers
DROP POLICY IF EXISTS "Users can view their own linux_peers" ON linux_peers;

-- Create new SELECT policy that allows:
-- 1. Admin to see all
-- 2. Users to see their own peers
-- 3. Semi-admins (users with can_create_users) to see peers created by users they created
CREATE POLICY "Users can view their own and created users linux_peers" ON linux_peers
    FOR SELECT
    USING (
        -- Admin can see all
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        OR
        -- User can see their own peers
        created_by_user_id = auth.uid()
        OR
        -- Semi-admin can see peers created by users they created
        EXISTS (
            SELECT 1 FROM profiles created_user
            WHERE created_user.id = linux_peers.created_by_user_id
            AND created_user.created_by_user_id = auth.uid()
        )
    );

-- Also update UPDATE policy to allow semi-admins to manage peers
DROP POLICY IF EXISTS "Users can update their own linux_peers" ON linux_peers;

CREATE POLICY "Users can update their own and created users linux_peers" ON linux_peers
    FOR UPDATE
    USING (
        -- Admin can update all
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        OR
        -- User can update their own peers
        created_by_user_id = auth.uid()
        OR
        -- Semi-admin can update peers created by users they created
        EXISTS (
            SELECT 1 FROM profiles created_user
            WHERE created_user.id = linux_peers.created_by_user_id
            AND created_user.created_by_user_id = auth.uid()
        )
    );

-- Also update DELETE policy to allow semi-admins to delete peers
DROP POLICY IF EXISTS "Users can delete their own linux_peers" ON linux_peers;

CREATE POLICY "Users can delete their own and created users linux_peers" ON linux_peers
    FOR DELETE
    USING (
        -- Admin can delete all
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        OR
        -- User can delete their own peers
        created_by_user_id = auth.uid()
        OR
        -- Semi-admin can delete peers created by users they created
        EXISTS (
            SELECT 1 FROM profiles created_user
            WHERE created_user.id = linux_peers.created_by_user_id
            AND created_user.created_by_user_id = auth.uid()
        )
    );

-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================
