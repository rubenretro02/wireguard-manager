# SOCKS5 Proxies Enhancement - TODOs

## Features Implemented
- [x] Redesign SOCKS5 page to match Dashboard (Peers) layout
- [x] Add "Name" column (internal name different from username)
- [x] Add "Connection" status (online/offline in real-time)
- [x] Add "Traffic" column (bytes sent/received)
- [x] Add "Created By" column
- [x] Add "Expires" column with timer functionality
- [x] Add suspend/enable toggle for proxies
- [x] Add timer/expiration functionality (auto-disable)
- [x] Add "Test Proxy" button to verify proxy works and show exit IP
- [x] Add stats cards at top (Total, Online, Active, Disabled, With Timer)
- [x] Update API route to support new features (toggleProxy, renewProxy, testProxy, updateExpiration)
- [x] Add search and filter functionality

## Recent Updates (Session Continued)
- [x] Changed "Test" button to "Proxy"
- [x] Improved connection status column to show:
  - Online with exit IP when test succeeds
  - Last connection time for all states
  - "Disabled" state shows last connection time
- [x] Updated "Online Now" stat card to "Recent Activity" for clarity
- [x] Changed column header from "Connection" to "Status"

## Latest Update - Status Column Fix
- [x] **Removed "Standby" status** - Now uses same style as Dashboard peers:
  - **Online** (green with animation) - When proxy has REAL active connections (detected via `ss` command)
  - **Offline** (amber/yellow) - When enabled but no active connections, shows "Never" or time since last connection
  - **Disabled** (gray with WifiOff icon) - When proxy is disabled

## Real-Time Connection Detection (Implemented)
- [x] **Backend**: Added `getActiveConnections()` method in `Socks5ProxyClient`
  - Uses `ss -tn state established '( sport = :1080 )'` to detect TCP connections
  - Returns map of IP -> number of active connections
- [x] **API**: Added `getActiveConnections` action in `/api/socks5` route
  - Updates `last_connected_at` for proxies with active connections
- [x] **Frontend**: Polling every 5 seconds
  - Calls `getActiveConnections` automatically
  - Updates `activeConnections` state in real-time
  - Shows number of active connections when proxy is Online

## Security Fix - can_delete Capability (Current Session)
- [x] **BUG FIXED**: Users without `can_delete` capability could delete peers and proxies
- [x] **Dashboard (peers)**: Added `canDelete` check to `handleDeletePeer` function
- [x] **Dashboard (peers)**: Hide delete buttons in UI when user doesn't have `canDelete`
- [x] **SOCKS5 (proxies)**: Added `canDelete` check to `handleDeleteProxy` function
- [x] **SOCKS5 (proxies)**: Hide delete buttons in UI when user doesn't have `canDelete`
- [x] **Public IPs page**: Added `canDelete` check and hide delete buttons
- [x] **API /api/wireguard**: Added `can_delete` capability check for `deletePeer` action
- [x] **API /api/socks5**: Added `can_delete` capability check for `deleteProxy` action

## Semi-Admin Capability Granting (Already Implemented ✅)
- [x] **Semi-admins can grant ANY capability to users they create**
  - No dependency on whether the semi-admin has the capability themselves
  - Capabilities only apply within the group (created user hierarchy)
  - Example: homeVPN can grant `can_see_all_peers` to Leonardo, even if homeVPN doesn't have that capability
  - This is intentional because group isolation ensures no privilege escalation
- [x] **Location**: `my-users/[id]/page.tsx` - `handleSaveUserInfo` function
- [x] **Available capabilities for group users**:
  - `can_auto_expire` - Set expiration timers on peers
  - `can_see_all_peers` - See all peers in the group (not just own)
  - `can_create_users` - Create sub-users (nested hierarchy)
  - `can_manage_user_ips` - Manage IP access for created users
  - `can_delete` - Delete peers and proxies
  - `can_see_all_proxies` - See all SOCKS5 proxies in the group
  - `can_see_group_peers` - See peers from parent + siblings

## Known Limitations / Pending Backend Work
- [ ] **Traffic tracking (bytes_sent, bytes_received)**: Currently shows 0 B because 3proxy doesn't natively track per-user traffic. To implement this, would need:
  - Parse 3proxy access logs periodically
  - Or use iptables rules to track traffic per user/IP
  - Create a background job to update traffic stats in database
- [ ] **Real-time online status**: The "Online" status is based on `last_connected_at` which only updates when testing proxy. True real-time tracking would require:
  - Monitoring 3proxy connections via logs
  - Or implementing a connection tracking daemon

## Notes
- The project requires Supabase environment variables to run
- Run the migration script: `scripts/migration-socks5-full-features.sql` to add the new columns
- The testProxy function uses curl through SSH to verify proxy connectivity
- Online status = tested within last 3 minutes (not actual active usage)
