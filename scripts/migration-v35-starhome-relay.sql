-- ============================================================
-- Migration v35: relay UDP para los slots de StarVPN (enable/disable sin rotar llaves)
--
-- StarVPN no permite apagar un slot. Solución: el config del cliente apunta a
-- UN SERVER NUESTRO (linux-ssh) en un puerto por slot (42000 + N), y ese server
-- reenvía el UDP a wg.starzone.io:1276 con una regla DNAT. Disable = quitar la
-- regla (el túnel muere en segundos), enable = volver a ponerla. La llave del
-- slot y el config del cliente no cambian. De paso, al pasar por nuestro server
-- se cuenta el tráfico (iptables) y se ve si hay conexión (conntrack).
--
-- Aplicada en producción el 2026-10-03 vía Management API.
-- ============================================================

ALTER TABLE starhome_accounts
    ADD COLUMN IF NOT EXISTS relay_router_id UUID REFERENCES routers(id) ON DELETE SET NULL;
ALTER TABLE starhome_accounts
    ADD COLUMN IF NOT EXISTS relay_target_ip TEXT;
COMMENT ON COLUMN starhome_accounts.relay_router_id IS 'Server linux-ssh nuestro que reenvía el WireGuard de cada slot a StarVPN (null = los clientes van directo, sin enable/disable)';
COMMENT ON COLUMN starhome_accounts.relay_target_ip IS 'IP de wg.starzone.io usada en las reglas DNAT (se re-resuelve en cada sync)';

ALTER TABLE starhome_slots
    ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN starhome_slots.disabled IS 'Relay apagado para este slot (solo tiene efecto con relay_router_id)';

-- IP pública de cada slot: la API no la da, pero el proxy del slot sí
-- (proxy.starzone.io:51312+N). Con la IP del relay autorizada en StarVPN
-- (Proxy Configuration → Authorized IP's), el relay consulta la IP de salida de
-- cada slot y el cron la guarda aquí (y registra en activity_logs cuando cambia).
ALTER TABLE starhome_slots
    ADD COLUMN IF NOT EXISTS public_ip TEXT;
ALTER TABLE starhome_slots
    ADD COLUMN IF NOT EXISTS public_ip_checked_at TIMESTAMPTZ;
ALTER TABLE starhome_accounts
    ADD COLUMN IF NOT EXISTS exit_ips_checked_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
