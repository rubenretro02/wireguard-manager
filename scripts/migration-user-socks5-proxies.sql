-- =====================================================
-- WireGuard Manager - User SOCKS5 Proxies Migration
-- Allows assigning SOCKS5 proxies to users (like routers)
-- =====================================================

-- Create user_socks5_proxies table
CREATE TABLE IF NOT EXISTS user_socks5_proxies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    socks5_proxy_id UUID NOT NULL REFERENCES socks5_proxies(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, socks5_proxy_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_socks5_proxies_user_id ON user_socks5_proxies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_socks5_proxies_proxy_id ON user_socks5_proxies(socks5_proxy_id);

-- Enable RLS
ALTER TABLE user_socks5_proxies ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies for user_socks5_proxies
-- =====================================================

-- SELECT: Admin sees all, Semi-admin sees assignments for users they created, User sees their own
CREATE POLICY "user_socks5_proxies_select" ON user_socks5_proxies
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
            WHERE assigned_user.id = user_socks5_proxies.user_id
            AND assigned_user.created_by_user_id = auth.uid()
        )
    );

-- INSERT: Admin only (or semi-admin for their users)
CREATE POLICY "user_socks5_proxies_insert" ON user_socks5_proxies
    FOR INSERT
    WITH CHECK (
        -- Admin can insert
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
        OR
        -- Semi-admin can assign to users they created
        EXISTS (
            SELECT 1 FROM profiles assigned_user
            WHERE assigned_user.id = user_socks5_proxies.user_id
            AND assigned_user.created_by_user_id = auth.uid()
        )
    );

-- DELETE: Admin only (or semi-admin for their users)
CREATE POLICY "user_socks5_proxies_delete" ON user_socks5_proxies
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
            WHERE assigned_user.id = user_socks5_proxies.user_id
            AND assigned_user.created_by_user_id = auth.uid()
        )
    );

-- =====================================================
-- RLS Policies for socks5_proxies table
-- (Update existing or create new)
-- =====================================================

-- Drop existing policies if any
DROP POLICY IF EXISTS "socks5_proxies_select" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_insert" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_update" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_delete" ON socks5_proxies;

-- Enable RLS on socks5_proxies
ALTER TABLE socks5_proxies ENABLE ROW LEVEL SECURITY;

-- SELECT: Admin sees all, Semi-admin sees proxies assigned to their users, User sees their assigned proxies
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
        -- User can see proxies assigned to them
        EXISTS (
            SELECT 1 FROM user_socks5_proxies
            WHERE user_socks5_proxies.socks5_proxy_id = socks5_proxies.id
            AND user_socks5_proxies.user_id = auth.uid()
        )
        OR
        -- Semi-admin can see proxies assigned to users they created
        EXISTS (
            SELECT 1 FROM user_socks5_proxies
            JOIN profiles assigned_user ON assigned_user.id = user_socks5_proxies.user_id
            WHERE user_socks5_proxies.socks5_proxy_id = socks5_proxies.id
            AND assigned_user.created_by_user_id = auth.uid()
        )
    );

-- INSERT: Admin only
CREATE POLICY "socks5_proxies_insert" ON socks5_proxies
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- UPDATE: Admin only
CREATE POLICY "socks5_proxies_update" ON socks5_proxies
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- DELETE: Admin only
CREATE POLICY "socks5_proxies_delete" ON socks5_proxies
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- =====================================================
-- Comments
-- =====================================================
COMMENT ON TABLE user_socks5_proxies IS 'Assigns SOCKS5 proxies to users, similar to user_routers';
COMMENT ON COLUMN user_socks5_proxies.user_id IS 'The user who has access to the proxy';
COMMENT ON COLUMN user_socks5_proxies.socks5_proxy_id IS 'The SOCKS5 proxy the user has access to';

-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================
