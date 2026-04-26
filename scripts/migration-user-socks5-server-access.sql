-- =====================================================
-- WireGuard Manager - User SOCKS5 Server Access Migration
-- Allows giving users access to SOCKS5 servers (routers) to CREATE their own proxies
-- Similar to how user_routers works for WireGuard
-- =====================================================

-- Create user_socks5_server_access table
CREATE TABLE IF NOT EXISTS user_socks5_server_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(user_id, router_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_socks5_server_access_user_id ON user_socks5_server_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_socks5_server_access_router_id ON user_socks5_server_access(router_id);

-- Enable RLS
ALTER TABLE user_socks5_server_access ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies for user_socks5_server_access
-- =====================================================

-- SELECT: Admin sees all, Semi-admin sees assignments for users they created, User sees their own
CREATE POLICY "user_socks5_server_access_select" ON user_socks5_server_access
    FOR SELECT
    USING (
        -- Admin can see all
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
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

-- INSERT: Admin only (or semi-admin for their users)
CREATE POLICY "user_socks5_server_access_insert" ON user_socks5_server_access
    FOR INSERT
    WITH CHECK (
        -- Admin can insert
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        OR
        -- Semi-admin can assign to users they created (only routers they have access to)
        (
            EXISTS (
                SELECT 1 FROM profiles assigned_user
                WHERE assigned_user.id = user_socks5_server_access.user_id
                AND assigned_user.created_by_user_id = auth.uid()
            )
            AND
            EXISTS (
                SELECT 1 FROM user_socks5_server_access parent_access
                WHERE parent_access.user_id = auth.uid()
                AND parent_access.router_id = user_socks5_server_access.router_id
            )
        )
    );

-- DELETE: Admin only (or semi-admin for their users)
CREATE POLICY "user_socks5_server_access_delete" ON user_socks5_server_access
    FOR DELETE
    USING (
        -- Admin can delete
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
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
-- Update socks5_proxies RLS to allow users to see/manage their own proxies
-- =====================================================

-- Drop existing policies if any
DROP POLICY IF EXISTS "socks5_proxies_select" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_insert" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_update" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_delete" ON socks5_proxies;

-- SELECT: Admin sees all, users see their own proxies + those in servers they have access to
CREATE POLICY "socks5_proxies_select" ON socks5_proxies
    FOR SELECT
    USING (
        -- Admin can see all
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        OR
        -- User can see proxies they created
        created_by = auth.uid()
        OR
        -- User can see proxies assigned to them (legacy table)
        EXISTS (
            SELECT 1 FROM user_socks5_proxies
            WHERE user_socks5_proxies.socks5_proxy_id = socks5_proxies.id
            AND user_socks5_proxies.user_id = auth.uid()
        )
        OR
        -- Semi-admin can see proxies in servers they have access to
        EXISTS (
            SELECT 1 FROM user_socks5_server_access
            WHERE user_socks5_server_access.user_id = auth.uid()
            AND user_socks5_server_access.router_id = socks5_proxies.router_id
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
            AND profiles.role = 'admin'
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

-- UPDATE: Admin or owner can update
CREATE POLICY "socks5_proxies_update" ON socks5_proxies
    FOR UPDATE
    USING (
        -- Admin can update any
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        OR
        -- Owner can update their own
        created_by = auth.uid()
    );

-- DELETE: Admin or owner can delete
CREATE POLICY "socks5_proxies_delete" ON socks5_proxies
    FOR DELETE
    USING (
        -- Admin can delete any
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        OR
        -- Owner can delete their own
        created_by = auth.uid()
    );

-- =====================================================
-- Comments
-- =====================================================
COMMENT ON TABLE user_socks5_server_access IS 'Gives users access to SOCKS5 servers (routers) to create their own proxies';
COMMENT ON COLUMN user_socks5_server_access.user_id IS 'The user who has access to create proxies on the server';
COMMENT ON COLUMN user_socks5_server_access.router_id IS 'The router/server where the user can create SOCKS5 proxies';

-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================
