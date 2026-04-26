-- =====================================================
-- WireGuard Manager - Fix Admin Role Case Sensitivity
-- This migration fixes RLS policies to use case-insensitive role checks
-- =====================================================

-- =====================================================
-- OPTION 1: Normalize all existing admin roles to lowercase 'admin'
-- Run this first to fix existing data
-- =====================================================
UPDATE profiles SET role = 'admin' WHERE LOWER(role) = 'admin' AND role != 'admin';

-- =====================================================
-- OPTION 2: Update RLS policies to use case-insensitive comparison
-- =====================================================

-- =====================================================
-- Fix user_socks5_server_access policies
-- =====================================================
DROP POLICY IF EXISTS "user_socks5_server_access_select" ON user_socks5_server_access;
DROP POLICY IF EXISTS "user_socks5_server_access_insert" ON user_socks5_server_access;
DROP POLICY IF EXISTS "user_socks5_server_access_delete" ON user_socks5_server_access;

-- SELECT: Admin sees all, Semi-admin sees assignments for users they created, User sees their own
CREATE POLICY "user_socks5_server_access_select" ON user_socks5_server_access
    FOR SELECT
    USING (
        -- Admin can see all (case-insensitive)
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

-- INSERT: Admin only (or semi-admin for their users)
CREATE POLICY "user_socks5_server_access_insert" ON user_socks5_server_access
    FOR INSERT
    WITH CHECK (
        -- Admin can insert (case-insensitive)
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
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
        -- Admin can delete (case-insensitive)
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
-- Fix socks5_proxies policies
-- =====================================================
DROP POLICY IF EXISTS "socks5_proxies_select" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_insert" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_update" ON socks5_proxies;
DROP POLICY IF EXISTS "socks5_proxies_delete" ON socks5_proxies;

-- SELECT: Admin sees all, users see their own proxies + those in servers they have access to
CREATE POLICY "socks5_proxies_select" ON socks5_proxies
    FOR SELECT
    USING (
        -- Admin can see all (case-insensitive)
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
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
        -- Admin can insert (case-insensitive)
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

-- UPDATE: Admin or owner can update
CREATE POLICY "socks5_proxies_update" ON socks5_proxies
    FOR UPDATE
    USING (
        -- Admin can update any (case-insensitive)
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- Owner can update their own
        created_by = auth.uid()
    );

-- DELETE: Admin or owner can delete
CREATE POLICY "socks5_proxies_delete" ON socks5_proxies
    FOR DELETE
    USING (
        -- Admin can delete any (case-insensitive)
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
        OR
        -- Owner can delete their own
        created_by = auth.uid()
    );

-- =====================================================
-- Fix profiles policies (if they exist)
-- =====================================================
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;

-- SELECT: Everyone can read profiles (needed for role checks)
CREATE POLICY "profiles_select" ON profiles
    FOR SELECT
    USING (true);

-- UPDATE: Admin can update any, users can update their own
CREATE POLICY "profiles_update" ON profiles
    FOR UPDATE
    USING (
        id = auth.uid()
        OR
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
            AND LOWER(p.role) = 'admin'
        )
    );

-- =====================================================
-- Fix routers policies (admin-only table)
-- =====================================================
DROP POLICY IF EXISTS "routers_select" ON routers;
DROP POLICY IF EXISTS "routers_insert" ON routers;
DROP POLICY IF EXISTS "routers_update" ON routers;
DROP POLICY IF EXISTS "routers_delete" ON routers;

-- SELECT: Admin can see all routers
CREATE POLICY "routers_select" ON routers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
    );

-- INSERT: Admin only
CREATE POLICY "routers_insert" ON routers
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
    );

-- UPDATE: Admin only
CREATE POLICY "routers_update" ON routers
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
    );

-- DELETE: Admin only
CREATE POLICY "routers_delete" ON routers
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) = 'admin'
        )
    );

-- =====================================================
-- DONE
-- =====================================================
