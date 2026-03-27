-- Migration V6: Router Clients
-- Tabla para gestionar MikroTiks clientes remotos

-- Crear tabla router_clients
CREATE TABLE IF NOT EXISTS router_clients (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,  -- IP o DDNS
    api_port INTEGER DEFAULT 8729,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    use_ssl BOOLEAN DEFAULT true,
    -- Estado
    is_online BOOLEAN DEFAULT false,
    last_seen TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    -- Info del router (se actualiza automáticamente)
    router_model VARCHAR(255),
    router_os_version VARCHAR(50),
    uptime VARCHAR(100),
    cpu_load INTEGER,
    memory_used INTEGER,
    memory_total INTEGER,
    -- VPN Status
    vpn_configured BOOLEAN DEFAULT false,
    vpn_interface_name VARCHAR(50),
    vpn_connected BOOLEAN DEFAULT false,
    vpn_last_handshake TIMESTAMP WITH TIME ZONE,
    -- Configuración VPN (peer info)
    vpn_private_key TEXT,
    vpn_address VARCHAR(50),
    vpn_peer_public_key TEXT,
    vpn_endpoint_ip VARCHAR(50),
    vpn_endpoint_port INTEGER,
    vpn_dns1 VARCHAR(50),
    vpn_dns2 VARCHAR(50),
    vpn_mtu INTEGER DEFAULT 1420,
    -- Metadata
    notes TEXT,
    tags TEXT[],
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_router_clients_created_by ON router_clients(created_by);
CREATE INDEX IF NOT EXISTS idx_router_clients_is_online ON router_clients(is_online);
CREATE INDEX IF NOT EXISTS idx_router_clients_vpn_configured ON router_clients(vpn_configured);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_router_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_router_clients_updated_at ON router_clients;
CREATE TRIGGER trigger_router_clients_updated_at
    BEFORE UPDATE ON router_clients
    FOR EACH ROW
    EXECUTE FUNCTION update_router_clients_updated_at();

-- RLS Policies
ALTER TABLE router_clients ENABLE ROW LEVEL SECURITY;

-- Admin puede ver y modificar todos
CREATE POLICY "Admin full access to router_clients"
    ON router_clients
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Usuarios pueden ver solo los suyos
CREATE POLICY "Users can view own router_clients"
    ON router_clients
    FOR SELECT
    TO authenticated
    USING (created_by = auth.uid());

-- Usuarios pueden crear sus propios router_clients
CREATE POLICY "Users can insert own router_clients"
    ON router_clients
    FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Usuarios pueden actualizar los suyos
CREATE POLICY "Users can update own router_clients"
    ON router_clients
    FOR UPDATE
    TO authenticated
    USING (created_by = auth.uid());

-- Usuarios pueden eliminar los suyos
CREATE POLICY "Users can delete own router_clients"
    ON router_clients
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- Tabla para logs de acciones en router_clients
CREATE TABLE IF NOT EXISTS router_client_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    router_client_id UUID REFERENCES router_clients(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'success', 'error', 'pending'
    details TEXT,
    executed_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_router_client_logs_router ON router_client_logs(router_client_id);
CREATE INDEX IF NOT EXISTS idx_router_client_logs_created ON router_client_logs(created_at DESC);

-- RLS para logs
ALTER TABLE router_client_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to router_client_logs"
    ON router_client_logs
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "Users can view own router_client_logs"
    ON router_client_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM router_clients
            WHERE router_clients.id = router_client_logs.router_client_id
            AND router_clients.created_by = auth.uid()
        )
    );