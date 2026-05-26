-- Migration v15: Per-IP WireGuard interface
-- Allows each public IP to be routed through a specific WG interface
-- instead of forcing all IPs on a router to share the same interface.
--
-- Backwards compatible: column is nullable; code falls back to
-- routers.wg_interface when this column is NULL.

ALTER TABLE public_ips
ADD COLUMN IF NOT EXISTS wg_interface TEXT;

COMMENT ON COLUMN public_ips.wg_interface IS
  'WireGuard interface name (wg0, wg1, ...) used for this IP. NULL = inherit from routers.wg_interface.';

-- Optional index if you frequently filter/group by interface
CREATE INDEX IF NOT EXISTS idx_public_ips_router_wg_interface
  ON public_ips (router_id, wg_interface);
