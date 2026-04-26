-- =====================================================
-- WireGuard Manager - Migration V11
-- Fix foreign key constraint on linux_peers to allow user deletion
-- =====================================================

-- Drop the existing foreign key constraint
ALTER TABLE linux_peers
DROP CONSTRAINT IF EXISTS linux_peers_created_by_user_id_fkey;

-- Re-add the foreign key with ON DELETE SET NULL
-- This allows deleting users while keeping their peers (with null created_by_user_id)
ALTER TABLE linux_peers
ADD CONSTRAINT linux_peers_created_by_user_id_fkey
FOREIGN KEY (created_by_user_id)
REFERENCES profiles(id)
ON DELETE SET NULL;

-- Also fix peer_metadata table if it has the same issue
ALTER TABLE peer_metadata
DROP CONSTRAINT IF EXISTS peer_metadata_created_by_user_id_fkey;

ALTER TABLE peer_metadata
ADD CONSTRAINT peer_metadata_created_by_user_id_fkey
FOREIGN KEY (created_by_user_id)
REFERENCES profiles(id)
ON DELETE SET NULL;

-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================
