-- =====================================================
-- WireGuard Manager - Migration V2
-- Nuevas tablas y campos para configuración de IPs
-- =====================================================

-- 1. Agregar campos de configuración IP a la tabla routers
-- =====================================================
ALTER TABLE routers
ADD COLUMN IF NOT EXISTS public_ip_prefix TEXT,
ADD COLUMN IF NOT EXISTS public_ip_mask TEXT DEFAULT '/25',
ADD COLUMN IF NOT EXISTS public_ip_network TEXT,
ADD COLUMN IF NOT EXISTS internal_prefix TEXT DEFAULT '10.10',
ADD COLUMN IF NOT EXISTS out_interface TEXT DEFAULT 'ether2',
ADD COLUMN IF NOT EXISTS wg_interface TEXT DEFAULT 'wg0';

-- Comentarios para documentación
COMMENT ON COLUMN routers.public_ip_prefix IS 'Prefijo de IP pública, ej: 76.245.59';
COMMENT ON COLUMN routers.public_ip_mask IS 'Máscara de red, ej: /25, /24, /26';
COMMENT ON COLUMN routers.public_ip_network IS 'Network del bloque, ej: 76.245.59.128';
COMMENT ON COLUMN routers.internal_prefix IS 'Prefijo interno para subnets, ej: 10.10';
COMMENT ON COLUMN routers.out_interface IS 'Interfaz de salida para NAT, ej: ether2';
COMMENT ON COLUMN routers.wg_interface IS 'Interfaz WireGuard, ej: wg0';


-- 2. Tabla public_ips - IPs públicas configuradas por admin
-- =====================================================
CREATE TABLE IF NOT EXISTS public_ips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    ip_number INTEGER NOT NULL,
    public_ip TEXT NOT NULL,
    internal_subnet TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    nat_rule_created BOOLEAN DEFAULT false,
    ip_address_created BOOLEAN DEFAULT false,
    wg_ip_created BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraint: ip_number único por router
    UNIQUE(router_id, ip_number)
);

-- Índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_public_ips_router_id ON public_ips(router_id);
CREATE INDEX IF NOT EXISTS idx_public_ips_enabled ON public_ips(enabled);

-- Comentarios
COMMENT ON TABLE public_ips IS 'IPs públicas configuradas por el admin para crear peers';
COMMENT ON COLUMN public_ips.ip_number IS 'Número de la IP, ej: 200 para 76.245.59.200';
COMMENT ON COLUMN public_ips.public_ip IS 'IP pública completa, ej: 76.245.59.200';
COMMENT ON COLUMN public_ips.internal_subnet IS 'Subnet interno, ej: 10.10.200';
COMMENT ON COLUMN public_ips.nat_rule_created IS 'Si la regla NAT fue creada en MikroTik';
COMMENT ON COLUMN public_ips.ip_address_created IS 'Si la IP fue agregada a la interfaz de salida';
COMMENT ON COLUMN public_ips.wg_ip_created IS 'Si la IP fue agregada a la interfaz WireGuard';


-- 3. Tabla user_routers - Control de acceso usuarios a routers
-- =====================================================
CREATE TABLE IF NOT EXISTS user_routers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Un usuario solo puede tener acceso una vez por router
    UNIQUE(user_id, router_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_routers_user_id ON user_routers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_routers_router_id ON user_routers(router_id);

-- Comentarios
COMMENT ON TABLE user_routers IS 'Control de acceso: qué usuarios pueden ver qué routers';


-- 4. Row Level Security (RLS) para las nuevas tablas
-- =====================================================

-- public_ips: Solo admins pueden ver/modificar
ALTER TABLE public_ips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do everything on public_ips" ON public_ips
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "Users can view enabled public_ips for their routers" ON public_ips
    FOR SELECT
    USING (
        enabled = true
        AND EXISTS (
            SELECT 1 FROM user_routers
            WHERE user_routers.user_id = auth.uid()
            AND user_routers.router_id = public_ips.router_id
        )
    );


-- user_routers: Solo admins pueden modificar, usuarios pueden ver los suyos
ALTER TABLE user_routers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do everything on user_routers" ON user_routers
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "Users can view their own router access" ON user_routers
    FOR SELECT
    USING (user_id = auth.uid());


-- 5. Función para auto-asignar IP interna disponible
-- =====================================================
CREATE OR REPLACE FUNCTION get_next_available_ip(
    p_router_id UUID,
    p_ip_number INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_internal_prefix TEXT;
    v_used_ips INTEGER[];
    v_next_ip INTEGER;
BEGIN
    -- Obtener el prefijo interno del router
    SELECT internal_prefix INTO v_internal_prefix
    FROM routers WHERE id = p_router_id;

    IF v_internal_prefix IS NULL THEN
        RETURN NULL;
    END IF;

    -- TODO: Esta función es placeholder
    -- La lógica real necesita consultar los peers existentes en MikroTik
    -- Por ahora retorna el siguiente número disponible

    RETURN v_internal_prefix || '.' || p_ip_number || '.2';
END;
$$;


-- 6. Trigger para actualizar updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_public_ips_updated_at
    BEFORE UPDATE ON public_ips
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- =====================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================

-- Para verificar que todo se creó correctamente:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'routers';
