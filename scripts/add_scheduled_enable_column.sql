-- Add scheduled_enable_at column to peer_metadata table
-- This column stores the date/time when a disabled peer should be automatically enabled

ALTER TABLE peer_metadata
ADD COLUMN IF NOT EXISTS scheduled_enable_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for faster queries on scheduled_enable_at
CREATE INDEX IF NOT EXISTS idx_peer_metadata_scheduled_enable
ON peer_metadata (scheduled_enable_at)
WHERE scheduled_enable_at IS NOT NULL;

-- Comment explaining the column
COMMENT ON COLUMN peer_metadata.scheduled_enable_at IS 'Date/time when the peer should be automatically enabled. NULL means no scheduled enable.';
