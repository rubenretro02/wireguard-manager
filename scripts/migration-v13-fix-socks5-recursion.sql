-- =====================================================
-- WireGuard Manager - Fix SOCKS5 Server Access RLS Recursion
-- This migration fixes the infinite recursion in user_socks5_server_access policies
-- =====================================================

-- Create a function to check if user has SOCKS5 server access (bypasses RLS)
CREATE OR REPLACE FUNCTION check_user_socks5_server_access(check_user_id UUID, check_router_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_socks5_server_access
        WHERE user_id = check_user_id
        AND router_id = check_router_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing policies
DROP POLICY IF EXISTS "user_socks5_server_access_select" ON user_socks5_server_access;
DROP POLICY IF EXISTS "user_socks5_server_access_insert" ON user_socks5_server_access;
DROP POLICY IF EXISTS "user_socks5_server_access_delete" ON user_socks5_server_access;

-- SELECT: Admin sees all, Semi-admin sees assignments for users they created, User sees their own
CREATE POLICY "user_socks5_server_access_select" ON user_socks5_server_access
    FOR SELECT
    USING (
        -- Admin can see all
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- User can see their own assignments
        user_id = auth.uid()
        OR
        -- Semi-admin can see assignments for users they created
        EXISTS (
            SELECT 1 FROM profiles assigned_user
            WHERE assigned_user.id = user_socks5_server_access.user_id
            AND assigned_user.created_by_user_id = auth.uid()
        )
    );

-- INSERT: Admin or semi-admin for their users (using function to avoid recursion)
CREATE POLICY "user_socks5_server_access_insert" ON user_socks5_server_access
    FOR INSERT
    WITH CHECK (
        -- Admin can insert
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- Semi-admin can assign to users they created (only routers they have access to)
        (
            -- Check that the target user was created by current user
            EXISTS (
                SELECT 1 FROM profiles assigned_user
                WHERE assigned_user.id = user_socks5_server_access.user_id
                AND assigned_user.created_by_user_id = auth.uid()
            )
            AND
            -- Check current user has access to this router (using function to avoid recursion)
            check_user_socks5_server_access(auth.uid(), user_socks5_server_access.router_id)
        )
    );

-- DELETE: Admin or semi-admin for their users
CREATE POLICY "user_socks5_server_access_delete" ON user_socks5_server_access
    FOR DELETE
    USING (
        -- Admin can delete
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- Semi-admin can delete assignments for users they created
        EXISTS (
            SELECT 1 FROM profiles assigned_user
            WHERE assigned_user.id = user_socks5_server_access.user_id
            AND assigned_user.created_by_user_id = auth.uid()
        )
    );

-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================
