# WireGuard Manager

A modern web application for managing WireGuard VPN peers on MikroTik routers and Linux servers with user management, capabilities, and public IP assignment.

## Features

- **Multi-Router Support**: Manage multiple MikroTik routers and Linux servers from a single dashboard
- **User Management**: Create users with different roles (admin/user) and capabilities
- **Peer Management**: Create, edit, enable/disable, and delete WireGuard peers
- **Public IP Management**: Assign public IPs to peers with NAT rules

## Linux Server Configuration - IMPORTANT!

### Configure Passwordless Sudo (REQUIRED!)

The application needs to execute sudo commands via SSH without a password prompt. Without this, you will see:
- "sudo: a terminal is required to read the password"
- "No interfaces found" when creating peers
- NAT rules failing to create

Run this on your Linux server:

```bash
sudo visudo -f /etc/sudoers.d/wireguard
```

Add this line (replace YOUR_USER with your SSH username):

```
YOUR_USER ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick, /sbin/iptables, /usr/sbin/iptables, /sbin/ip, /usr/sbin/iptables-save, /bin/cat, /bin/ls
```

Test with: `sudo -n wg show`

## Database Migrations

Run in order:
1. `scripts/migration-v6-linux-ssh.sql`
2. `scripts/migration-v7-linux-peers.sql`

## Troubleshooting

### "sudo: a terminal is required to read the password"
Configure passwordless sudo as shown above.

### "No interfaces found"
1. Sudo commands failing (see above)
2. WireGuard not running: `sudo systemctl status wg-quick@wg1`

### Connection shows "Connected" but fails
Check browser console (F12) for detailed sudo configuration instructions.

## License
MIT
