-- =============================================
-- CAR INTEL API INFRASTRUCTURE
-- Organizations, API Keys, Usage Tracking
-- =============================================

-- =============================================
-- SUBSCRIPTION TIERS
-- =============================================

CREATE TABLE IF NOT EXISTS subscription_tiers (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    monthly_price_cents INTEGER NOT NULL,
    monthly_token_limit INTEGER, -- NULL = unlimited
    rate_limit_per_minute INTEGER NOT NULL,
    features JSONB DEFAULT '{}',
    stripe_price_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initial tiers
INSERT INTO subscription_tiers (id, name, monthly_price_cents, monthly_token_limit, rate_limit_per_minute, features) VALUES
    ('free', 'Free', 0, 1000, 10, '{"api": true, "mcp": true, "cli": true}'),
    ('starter', 'Starter', 4900, 50000, 60, '{"api": true, "mcp": true, "cli": true, "support": "email"}'),
    ('pro', 'Pro', 19900, 500000, 300, '{"api": true, "mcp": true, "cli": true, "support": "priority"}'),
    ('enterprise', 'Enterprise', 0, null, 1000, '{"api": true, "mcp": true, "cli": true, "support": "dedicated", "sla": true}')
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- ORGANIZATIONS
-- =============================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    stripe_customer_id VARCHAR(100),
    subscription_tier_id VARCHAR(20) REFERENCES subscription_tiers(id) DEFAULT 'free',
    subscription_status VARCHAR(20) DEFAULT 'active' CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'trialing')),
    billing_email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_stripe ON organizations(stripe_customer_id);

-- =============================================
-- API KEYS
-- =============================================

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hash of the actual key
    key_prefix VARCHAR(20) NOT NULL, -- "ci_live_abc..." for display/identification
    environment VARCHAR(10) NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'test')),
    scopes TEXT[] DEFAULT ARRAY['read'],
    rate_limit_override INTEGER, -- NULL = use tier default
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE, -- NULL = never expires
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active) WHERE is_active = true;

-- =============================================
-- USAGE LOGS (detailed per-request logging)
-- =============================================

CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    endpoint VARCHAR(100) NOT NULL,
    method VARCHAR(10) NOT NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('api', 'mcp', 'cli', 'sdk')),
    request_params JSONB,
    response_status INTEGER,
    tokens_used INTEGER DEFAULT 1,
    latency_ms INTEGER,
    ip_address INET,
    user_agent VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Partition by month for better performance on large tables
-- For now, use standard indexes
CREATE INDEX IF NOT EXISTS idx_usage_logs_org ON usage_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_key ON usage_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_org_created ON usage_logs(organization_id, created_at);

-- =============================================
-- USAGE DAILY (aggregated for billing)
-- =============================================

CREATE TABLE IF NOT EXISTS usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    source VARCHAR(20) NOT NULL,
    endpoint VARCHAR(100) NOT NULL,
    request_count INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    UNIQUE(organization_id, date, source, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_org_date ON usage_daily(organization_id, date);

-- =============================================
-- ORGANIZATION MEMBERS (for team access)
-- =============================================

CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to get organization's current month usage
CREATE OR REPLACE FUNCTION get_org_monthly_usage(org_id UUID)
RETURNS TABLE(total_requests BIGINT, total_tokens BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(request_count), 0)::BIGINT as total_requests,
        COALESCE(SUM(tokens_used), 0)::BIGINT as total_tokens
    FROM usage_daily
    WHERE organization_id = org_id
    AND date >= date_trunc('month', CURRENT_DATE)::DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment daily usage (upsert)
CREATE OR REPLACE FUNCTION increment_daily_usage(
    p_org_id UUID,
    p_date DATE,
    p_source VARCHAR(20),
    p_endpoint VARCHAR(100),
    p_requests INTEGER DEFAULT 1,
    p_tokens INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO usage_daily (organization_id, date, source, endpoint, request_count, tokens_used)
    VALUES (p_org_id, p_date, p_source, p_endpoint, p_requests, p_tokens)
    ON CONFLICT (organization_id, date, source, endpoint)
    DO UPDATE SET
        request_count = usage_daily.request_count + p_requests,
        tokens_used = usage_daily.tokens_used + p_tokens;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to validate API key and return org info
CREATE OR REPLACE FUNCTION validate_api_key(p_key_hash VARCHAR(64))
RETURNS TABLE(
    api_key_id UUID,
    organization_id UUID,
    org_name VARCHAR(200),
    tier_id VARCHAR(20),
    rate_limit INTEGER,
    monthly_limit INTEGER,
    is_valid BOOLEAN,
    rejection_reason VARCHAR(100)
) AS $$
DECLARE
    v_key_record RECORD;
    v_org_record RECORD;
    v_tier_record RECORD;
    v_current_usage BIGINT;
BEGIN
    -- Find the API key
    SELECT * INTO v_key_record
    FROM api_keys ak
    WHERE ak.key_hash = p_key_hash;

    IF NOT FOUND THEN
        RETURN QUERY SELECT
            NULL::UUID, NULL::UUID, NULL::VARCHAR(200), NULL::VARCHAR(20),
            NULL::INTEGER, NULL::INTEGER, false, 'invalid_key'::VARCHAR(100);
        RETURN;
    END IF;

    -- Check if key is active
    IF NOT v_key_record.is_active THEN
        RETURN QUERY SELECT
            v_key_record.id, v_key_record.organization_id, NULL::VARCHAR(200), NULL::VARCHAR(20),
            NULL::INTEGER, NULL::INTEGER, false, 'key_disabled'::VARCHAR(100);
        RETURN;
    END IF;

    -- Check if key is expired
    IF v_key_record.expires_at IS NOT NULL AND v_key_record.expires_at < NOW() THEN
        RETURN QUERY SELECT
            v_key_record.id, v_key_record.organization_id, NULL::VARCHAR(200), NULL::VARCHAR(20),
            NULL::INTEGER, NULL::INTEGER, false, 'key_expired'::VARCHAR(100);
        RETURN;
    END IF;

    -- Get organization
    SELECT * INTO v_org_record
    FROM organizations o
    WHERE o.id = v_key_record.organization_id;

    -- Check subscription status
    IF v_org_record.subscription_status != 'active' AND v_org_record.subscription_status != 'trialing' THEN
        RETURN QUERY SELECT
            v_key_record.id, v_key_record.organization_id, v_org_record.name, v_org_record.subscription_tier_id,
            NULL::INTEGER, NULL::INTEGER, false, 'subscription_inactive'::VARCHAR(100);
        RETURN;
    END IF;

    -- Get tier info
    SELECT * INTO v_tier_record
    FROM subscription_tiers st
    WHERE st.id = v_org_record.subscription_tier_id;

    -- Check monthly usage limit
    IF v_tier_record.monthly_token_limit IS NOT NULL THEN
        SELECT total_tokens INTO v_current_usage
        FROM get_org_monthly_usage(v_key_record.organization_id);

        IF v_current_usage >= v_tier_record.monthly_token_limit THEN
            RETURN QUERY SELECT
                v_key_record.id, v_key_record.organization_id, v_org_record.name, v_org_record.subscription_tier_id,
                COALESCE(v_key_record.rate_limit_override, v_tier_record.rate_limit_per_minute),
                v_tier_record.monthly_token_limit,
                false, 'quota_exceeded'::VARCHAR(100);
            RETURN;
        END IF;
    END IF;

    -- Update last_used_at
    UPDATE api_keys SET last_used_at = NOW() WHERE id = v_key_record.id;

    -- Return success
    RETURN QUERY SELECT
        v_key_record.id,
        v_key_record.organization_id,
        v_org_record.name,
        v_org_record.subscription_tier_id,
        COALESCE(v_key_record.rate_limit_override, v_tier_record.rate_limit_per_minute),
        v_tier_record.monthly_token_limit,
        true,
        NULL::VARCHAR(100);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;

-- Subscription tiers are public read
CREATE POLICY "Allow public read on subscription_tiers"
    ON subscription_tiers FOR SELECT USING (true);

-- Organizations: members can read their own org
CREATE POLICY "Users can read their organizations"
    ON organizations FOR SELECT
    USING (
        id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
        OR owner_user_id = auth.uid()
    );

-- API keys: org members can read their org's keys
CREATE POLICY "Users can read their org API keys"
    ON api_keys FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

-- Organization members: can read members of their orgs
CREATE POLICY "Users can read their org members"
    ON organization_members FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

-- Usage logs: org members can read their org's usage
CREATE POLICY "Users can read their org usage logs"
    ON usage_logs FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

-- Usage daily: org members can read their org's aggregated usage
CREATE POLICY "Users can read their org daily usage"
    ON usage_daily FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

-- =============================================
-- SERVICE ROLE POLICIES (for Edge Functions)
-- =============================================

-- These allow the service role (used by Edge Functions) to manage all data
-- The service role bypasses RLS by default, but we add explicit policies for clarity

-- Grant usage on sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- =============================================
-- TRIGGERS
-- =============================================

-- Update updated_at on organizations
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
