-- Migration V3: Add restricted IPs and created_by tracking
-- Run this in Supabase SQL Editor

-- Add restricted column to public_ips
ALTER TABLE public_ips ADD COLUMN IF NOT EXISTS restricted BOOLEAN DEFAULT false;

-- Add created_by column to public_ips (stores user email or id)
ALTER TABLE public_ips ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Update existing rows to have restricted = false
UPDATE public_ips SET restricted = false WHERE restricted IS NULL;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_public_ips_restricted ON public_ips(restricted);
CREATE INDEX IF NOT EXISTS idx_public_ips_created_by ON public_ips(created_by);
