-- Create peer_metadata table to store custom panel-level metadata for WireGuard peers
-- This data is NOT stored on the MikroTik router, only in the panel's database

CREATE TABLE IF NOT EXISTS peer_metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  router_id TEXT NOT NULL,
  peer_mikrotik_id TEXT NOT NULL,
  peer_name TEXT,
  peer_interface TEXT,
  allowed_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by_email TEXT,
  created_by_user_id UUID,
  UNIQUE(router_id, peer_mikrotik_id)
);

-- Enable RLS
ALTER TABLE peer_metadata ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all peer metadata
CREATE POLICY "Authenticated users can read peer metadata"
  ON peer_metadata FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert peer metadata
CREATE POLICY "Authenticated users can insert peer metadata"
  ON peer_metadata FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to delete peer metadata
CREATE POLICY "Authenticated users can delete peer metadata"
  ON peer_metadata FOR DELETE
  TO authenticated
  USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_peer_metadata_router ON peer_metadata(router_id);
CREATE INDEX IF NOT EXISTS idx_peer_metadata_peer ON peer_metadata(peer_mikrotik_id);
