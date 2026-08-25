-- ============================================================
-- Migration v27: IP de endpoint separada de la IP de gestión
--
-- `routers.host` es la IP por la que el panel entra por SSH. En los servers
-- detrás de un CHR/gateway residencial (Zoe, mini HP) esa IP es la del GATEWAY,
-- no la de la máquina: el SSH llega por un port-forward, pero WireGuard escucha
-- en las IPs del bloque que sí están en la interfaz (verificado con tcpdump:
-- los clientes de Zoe pegan a .66/.75/.124, y la máquina no tiene la .65).
--
-- Un registro A que apunte a `host` en esos servers no conectaría a nadie, así
-- que el endpoint tiene su propia columna. NULL = usar `host` (el caso normal).
-- ============================================================

ALTER TABLE routers ADD COLUMN IF NOT EXISTS endpoint_ip TEXT;

COMMENT ON COLUMN routers.endpoint_ip IS 'IP a la que apunta el registro A del endpoint. NULL = usar host. Debe ser una IP que la máquina tenga en su interfaz y reciba UDP entrante.';

-- Zoe: el server arranca en .66; la .65 es el CHR
UPDATE routers SET endpoint_ip = '50.185.170.66' WHERE host = '50.185.170.65' AND endpoint_ip IS NULL;
