# WireGuard Manager - Contexto del Proyecto

## Repositorio
https://github.com/rubenretro02/wireguard-manager

Rama con UI nueva: `redesign-ui`

## Qué es
App web para gestionar peers de WireGuard en routers MikroTik con Supabase como backend.

## Stack
- Next.js 15 + Tailwind CSS + shadcn/ui
- Supabase (Auth + PostgreSQL)
- routeros-client para MikroTik
- Vercel para deploy

## Lo que ya hicimos

### UI Nueva (rama redesign-ui)
- Diseño dark mode moderno estilo Vercel/Linear
- Sidebar con navegación
- Stats cards (Total peers, Activos, Deshabilitados, Subnets)
- Tabla moderna con iconos
- Botón lápiz para editar nombre del peer
- Botón para invertir orden (más recientes arriba)
- Force Refresh para limpiar caché
- Eliminado modo demo

### Backend
- Conexión a MikroTik via API (8728) o REST (443)
- Generación automática de claves WireGuard
- Cache de conexiones con función para limpiar

## Lo que falta implementar

### 1. Admin Panel - Configuración de Router
Agregar estos campos al formulario de router:
- public_ip_prefix (ej: 76.245.59)
- public_ip_mask (ej: /25)
- public_ip_network (ej: 76.245.59.128)
- internal_prefix (ej: 10.10)
- out_interface (ej: ether2)
- wg_interface (ej: wg0)

### 2. Admin Panel - Gestión de IPs Públicas
- Nueva tabla `public_ips`
- UI para agregar IPs (solo escribir número ej: 200)
- Al agregar, crear automáticamente en MikroTik:
  - IP en ether2 (76.245.59.200/25)
  - Regla NAT (10.10.200.0/24 → 76.245.59.200)
  - IP en WireGuard interface (10.10.200.1/24)

### 3. Control de Acceso
- Nueva tabla `user_routers`
- Usuarios solo ven routers asignados por admin

### 4. Crear Peer Simplificado
Usuario solo selecciona:
- Interface (dropdown)
- Nombre (input)
- IP Pública (dropdown - solo IPs configuradas por admin)

Sistema automáticamente asigna IP interna disponible.

### 5. Auto-Import desde MikroTik
- Leer reglas NAT existentes (SOLO LECTURA)
- Detectar IPs y subnets configurados
- Importar a Supabase

## SQL para Supabase

```sql
ALTER TABLE routers
ADD COLUMN IF NOT EXISTS public_ip_prefix TEXT,
ADD COLUMN IF NOT EXISTS public_ip_mask TEXT DEFAULT '/25',
ADD COLUMN IF NOT EXISTS public_ip_network TEXT,
ADD COLUMN IF NOT EXISTS internal_prefix TEXT DEFAULT '10.10',
ADD COLUMN IF NOT EXISTS out_interface TEXT DEFAULT 'ether2',
ADD COLUMN IF NOT EXISTS wg_interface TEXT DEFAULT 'wg0';

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
    UNIQUE(router_id, ip_number)
);

CREATE TABLE IF NOT EXISTS user_routers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, router_id)
);

ALTER TABLE public_ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_routers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access public_ips" ON public_ips FOR ALL
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users view enabled IPs" ON public_ips FOR SELECT
USING (enabled = true AND EXISTS (
    SELECT 1 FROM user_routers WHERE user_id = auth.uid() AND router_id = public_ips.router_id
));

CREATE POLICY "Admins full access user_routers" ON user_routers FOR ALL
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users view own access" ON user_routers FOR SELECT
USING (user_id = auth.uid());
```

## Mi Setup

- Bloque /25 de IPs públicas (76.245.59.128 - 76.245.59.255)
- Subnets internos: 10.10.129, 10.10.130, 10.10.200, etc.
- El último octeto del subnet = último octeto de IP pública
- Interface de salida: ether2
- ~167 peers actuales
- Los usuarios NO deben poder escribir IPs, solo seleccionar

## Diseño
- Dark mode, fondo #0a0a0a
- Color accent: verde/cyan
- Estilo: Vercel/Linear

## Notas
- Import es SOLO LECTURA del MikroTik
- Cada router puede tener diferentes prefijos
- Sin modo demo, requiere router real

## ⚠️ Vercel - Importante
Vercel Hobby (gratis) NO despliega commits de colaboradores externos.
Los commits de "Same" no se despliegan automáticamente.

**Solución:** Después de que Same haga commits, crear un PR y hacer merge desde GitHub con MI cuenta. El merge commit será mío y Vercel lo desplegará.

Alternativa: Configurar los commits para usar mi nombre:
```bash
git config user.name "rubenretro02"
git config user.email "mi-email@ejemplo.com"
```

## Próximos pasos
1. Clonar repo y rama redesign-ui
2. Verificar integraciones (GitHub + Supabase)
3. Ejecutar SQL en Supabase
4. Implementar configuración de IPs en Admin Panel
5. Implementar auto-import
6. Simplificar creación de peers
