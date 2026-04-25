-- =====================================================
-- WireGuard Manager - Migration V7
-- Almacenamiento de peers Linux para enable/disable
-- =====================================================

-- Tabla para almacenar datos de peers Linux
-- Necesario porque WireGuard Linux no tiene campos de comentario/nombre
-- y para poder hacer enable/disable (quitar y re-agregar)
CREATE TABLE IF NOT EXISTS linux_peers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    private_key TEXT,
    allowed_ips TEXT NOT NULL,
    name TEXT,
    comment TEXT,
    public_ip TEXT,
    disabled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by_user_id UUID REFERENCES profiles(id),
    created_by_email TEXT,

    -- Unique constraint: one peer per public key per router
    UNIQUE(router_id, public_key)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_linux_peers_router_id ON linux_peers(router_id);
CREATE INDEX IF NOT EXISTS idx_linux_peers_public_key ON linux_peers(public_key);
CREATE INDEX IF NOT EXISTS idx_linux_peers_disabled ON linux_peers(disabled);
CREATE INDEX IF NOT EXISTS idx_linux_peers_public_ip ON linux_peers(public_ip);

-- Comentarios
COMMENT ON TABLE linux_peers IS 'Almacena datos de peers de servidores Linux WireGuard';
COMMENT ON COLUMN linux_peers.public_key IS 'Clave pública del peer';
COMMENT ON COLUMN linux_peers.private_key IS 'Clave privada del peer (opcional, para generar configs)';
COMMENT ON COLUMN linux_peers.allowed_ips IS 'IPs permitidas del peer (ej: 10.10.200.5/32)';
COMMENT ON COLUMN linux_peers.name IS 'Nombre del peer';
COMMENT ON COLUMN linux_peers.comment IS 'Comentario/IP pública asociada';
COMMENT ON COLUMN linux_peers.public_ip IS 'IP pública NAT asociada';
COMMENT ON COLUMN linux_peers.disabled IS 'Si está deshabilitado (removido de WireGuard pero guardado aquí)';

-- RLS Policies
ALTER TABLE linux_peers ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can do everything on linux_peers" ON linux_peers
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Users can view/modify their own peers
CREATE POLICY "Users can view their own linux_peers" ON linux_peers
    FOR SELECT
    USING (
        created_by_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "Users can insert their own linux_peers" ON linux_peers
    FOR INSERT
    WITH CHECK (
        created_by_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "Users can update their own linux_peers" ON linux_peers
    FOR UPDATE
    USING (
        created_by_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "Users can delete their own linux_peers" ON linux_peers
    FOR DELETE
    USING (
        created_by_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Trigger para updated_at
CREATE TRIGGER update_linux_peers_updated_at
    BEFORE UPDATE ON linux_peers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================
