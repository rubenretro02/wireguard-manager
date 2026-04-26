-- =====================================================
-- WireGuard Manager - Semi-admin can see proxies of their created users
-- This allows semi-admins to view and manage proxies created by users they created
-- =====================================================

-- Drop existing socks5_proxies policies
DROP POLICY IF EXISTS "socks5_proxies_select" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_insert" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_update" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_delete" ON socks5_proxies;

-- SELECT: Admin sees all, users see their own, semi-admin sees their users' proxies
CREATE POLICY "socks5_proxies_select" ON socks5_proxies
    FOR SELECT
    USING (
        -- Admin can see all
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- User can see proxies they created
        created_by = auth.uid()
        OR
        -- User can see proxies in servers they have access to
        EXISTS (
            SELECT 1 FROM user_socks5_server_access
            WHERE user_socks5_server_access.user_id = auth.uid()
            AND user_socks5_server_access.router_id = socks5_proxies.router_id
        )
        OR
        -- Semi-admin can see proxies created by users they created
        EXISTS (
            SELECT 1 FROM profiles proxy_creator
            WHERE proxy_creator.id = socks5_proxies.created_by
            AND proxy_creator.created_by_user_id = auth.uid()
        )
    );

-- INSERT: Admin or users with server access can create proxies
CREATE POLICY "socks5_proxies_insert" ON socks5_proxies
    FOR INSERT
    WITH CHECK (
        -- Admin can insert
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- User with server access can create proxies (must set created_by to themselves)
        (
            created_by = auth.uid()
            AND
            EXISTS (
                SELECT 1 FROM user_socks5_server_access
                WHERE user_socks5_server_access.user_id = auth.uid()
                AND user_socks5_server_access.router_id = socks5_proxies.router_id
            )
        )
    );

-- UPDATE: Admin, owner, or semi-admin can update
CREATE POLICY "socks5_proxies_update" ON socks5_proxies
    FOR UPDATE
    USING (
        -- Admin can update any
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- Owner can update their own
        created_by = auth.uid()
        OR
        -- Semi-admin can update proxies of users they created
        EXISTS (
            SELECT 1 FROM profiles proxy_creator
            WHERE proxy_creator.id = socks5_proxies.created_by
            AND proxy_creator.created_by_user_id = auth.uid()
        )
    );

-- DELETE: Admin, owner, or semi-admin can delete
CREATE POLICY "socks5_proxies_delete" ON socks5_proxies
    FOR DELETE
    USING (
        -- Admin can delete any
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- Owner can delete their own
        created_by = auth.uid()
        OR
        -- Semi-admin can delete proxies of users they created
        EXISTS (
            SELECT 1 FROM profiles proxy_creator
            WHERE proxy_creator.id = socks5_proxies.created_by
            AND proxy_creator.created_by_user_id = auth.uid()
        )
    );

-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================
