-- =============================================
-- ADMIN SYSTEM MIGRATION
-- Super admin, enterprise domains, invites, audit log
-- =============================================

-- =============================================
-- 1. ADMIN USERS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'admin', 'support')),
    permissions JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_users_user ON admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);

-- =============================================
-- 2. ENTERPRISE EMAIL DOMAINS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS enterprise_email_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    tier_id VARCHAR(20) REFERENCES subscription_tiers(id) DEFAULT 'enterprise',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_enterprise_domains_domain ON enterprise_email_domains(domain);
CREATE INDEX IF NOT EXISTS idx_enterprise_domains_active ON enterprise_email_domains(is_active) WHERE is_active = true;

-- =============================================
-- 3. USER INVITES TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS user_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    invited_by UUID NOT NULL REFERENCES auth.users(id),
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_invites_email ON user_invites(email);
CREATE INDEX IF NOT EXISTS idx_user_invites_org ON user_invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_invites_token ON user_invites(token);
CREATE INDEX IF NOT EXISTS idx_user_invites_pending ON user_invites(expires_at) WHERE accepted_at IS NULL;

-- =============================================
-- 4. ADMIN AUDIT LOG TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES auth.users(id),
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON admin_audit_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at);

-- =============================================
-- 5. ADD STATUS COLUMNS TO ORGANIZATIONS
-- =============================================

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'suspended', 'revoked'));

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES auth.users(id);

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS pause_reason TEXT;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id);

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS revoke_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- =============================================
-- 6. HELPER FUNCTIONS
-- =============================================

-- Function to check if a user is an admin
CREATE OR REPLACE FUNCTION is_admin(check_user_id UUID, required_role TEXT DEFAULT 'admin')
RETURNS BOOLEAN AS $$
DECLARE
    admin_role TEXT;
BEGIN
    SELECT role INTO admin_role FROM admin_users WHERE user_id = check_user_id;

    IF admin_role IS NULL THEN
        RETURN FALSE;
    END IF;

    IF required_role = 'super_admin' THEN
        RETURN admin_role = 'super_admin';
    ELSIF required_role = 'admin' THEN
        RETURN admin_role IN ('super_admin', 'admin');
    ELSE
        RETURN TRUE; -- support or higher
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get admin role for a user
CREATE OR REPLACE FUNCTION get_admin_role(check_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    admin_role TEXT;
BEGIN
    SELECT role INTO admin_role FROM admin_users WHERE user_id = check_user_id;
    RETURN admin_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log admin actions
CREATE OR REPLACE FUNCTION log_admin_action(
    p_admin_user_id UUID,
    p_action VARCHAR(50),
    p_target_type VARCHAR(50),
    p_target_id UUID DEFAULT NULL,
    p_details JSONB DEFAULT NULL,
    p_ip_address INET DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details, ip_address)
    VALUES (p_admin_user_id, p_action, p_target_type, p_target_id, p_details, p_ip_address)
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if email domain is enterprise
CREATE OR REPLACE FUNCTION is_enterprise_domain(p_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    email_domain TEXT;
BEGIN
    email_domain := split_part(p_email, '@', 2);

    RETURN EXISTS (
        SELECT 1 FROM enterprise_email_domains
        WHERE domain = email_domain AND is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get enterprise tier for email domain
CREATE OR REPLACE FUNCTION get_enterprise_tier_for_email(p_email TEXT)
RETURNS VARCHAR(20) AS $$
DECLARE
    email_domain TEXT;
    v_tier_id VARCHAR(20);
BEGIN
    email_domain := split_part(p_email, '@', 2);

    SELECT tier_id INTO v_tier_id
    FROM enterprise_email_domains
    WHERE domain = email_domain AND is_active = TRUE;

    RETURN v_tier_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 7. AUTO-ASSIGN ENTERPRISE TIER TRIGGER
-- =============================================

CREATE OR REPLACE FUNCTION auto_assign_enterprise_tier()
RETURNS TRIGGER AS $$
DECLARE
    user_email TEXT;
    email_domain TEXT;
    enterprise_domain RECORD;
BEGIN
    -- Get user email from auth.users
    SELECT email INTO user_email FROM auth.users WHERE id = NEW.owner_user_id;

    IF user_email IS NOT NULL THEN
        email_domain := split_part(user_email, '@', 2);

        SELECT * INTO enterprise_domain
        FROM enterprise_email_domains
        WHERE domain = email_domain AND is_active = TRUE;

        IF FOUND THEN
            NEW.subscription_tier_id := enterprise_domain.tier_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS org_auto_enterprise_tier ON organizations;

CREATE TRIGGER org_auto_enterprise_tier
    BEFORE INSERT ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_enterprise_tier();

-- =============================================
-- 8. UPDATE VALIDATE_API_KEY FOR ORG STATUS
-- =============================================

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

    -- Check organization status (NEW: check for paused/suspended/revoked)
    IF v_org_record.status IS NOT NULL AND v_org_record.status != 'active' THEN
        RETURN QUERY SELECT
            v_key_record.id, v_key_record.organization_id, v_org_record.name, v_org_record.subscription_tier_id,
            NULL::INTEGER, NULL::INTEGER, false, ('organization_' || v_org_record.status)::VARCHAR(100);
        RETURN;
    END IF;

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
-- 9. ROW LEVEL SECURITY
-- =============================================

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin users: only admins can read
CREATE POLICY "Admins can read admin_users"
    ON admin_users FOR SELECT
    USING (is_admin(auth.uid(), 'support'));

-- Enterprise domains: only admins can read
CREATE POLICY "Admins can read enterprise_domains"
    ON enterprise_email_domains FOR SELECT
    USING (is_admin(auth.uid(), 'support'));

-- User invites: org owners/admins can manage their org invites
CREATE POLICY "Org admins can read invites"
    ON user_invites FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
        OR is_admin(auth.uid(), 'support')
    );

CREATE POLICY "Org admins can create invites"
    ON user_invites FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
        OR is_admin(auth.uid(), 'admin')
    );

CREATE POLICY "Org admins can update invites"
    ON user_invites FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
        OR is_admin(auth.uid(), 'admin')
    );

CREATE POLICY "Org admins can delete invites"
    ON user_invites FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
        OR is_admin(auth.uid(), 'admin')
    );

-- Audit log: only admins can read (append-only, no update/delete policies)
CREATE POLICY "Admins can read audit_log"
    ON admin_audit_log FOR SELECT
    USING (is_admin(auth.uid(), 'support'));

-- =============================================
-- 10. ADMIN-ONLY POLICIES FOR ORGANIZATIONS
-- =============================================

-- Allow admins to read all organizations
CREATE POLICY "Admins can read all organizations"
    ON organizations FOR SELECT
    USING (is_admin(auth.uid(), 'support'));

-- Allow admins to update organizations (change tier, status)
CREATE POLICY "Admins can update organizations"
    ON organizations FOR UPDATE
    USING (is_admin(auth.uid(), 'admin'));

-- Allow admins to read all API keys
CREATE POLICY "Admins can read all API keys"
    ON api_keys FOR SELECT
    USING (is_admin(auth.uid(), 'support'));

-- Allow admins to read all usage logs
CREATE POLICY "Admins can read all usage logs"
    ON usage_logs FOR SELECT
    USING (is_admin(auth.uid(), 'support'));

-- Allow admins to read all daily usage
CREATE POLICY "Admins can read all daily usage"
    ON usage_daily FOR SELECT
    USING (is_admin(auth.uid(), 'support'));

-- Allow admins to read all org members
CREATE POLICY "Admins can read all org members"
    ON organization_members FOR SELECT
    USING (is_admin(auth.uid(), 'support'));

-- Allow admins to manage org members
CREATE POLICY "Admins can insert org members"
    ON organization_members FOR INSERT
    WITH CHECK (is_admin(auth.uid(), 'admin'));

CREATE POLICY "Admins can update org members"
    ON organization_members FOR UPDATE
    USING (is_admin(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete org members"
    ON organization_members FOR DELETE
    USING (is_admin(auth.uid(), 'admin'));

-- =============================================
-- 11. ORGANIZATION MEMBER MANAGEMENT POLICIES
-- =============================================

-- Org owners can add members
CREATE POLICY "Org owners can add members"
    ON organization_members FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
        )
        OR (
            organization_id IN (
                SELECT organization_id FROM organization_members
                WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
            )
        )
    );

-- Org owners can remove members
CREATE POLICY "Org owners can remove members"
    ON organization_members FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
        )
        OR (
            organization_id IN (
                SELECT organization_id FROM organization_members
                WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
            )
            AND user_id != auth.uid() -- Can't remove yourself
        )
    );

-- Org owners can update member roles
CREATE POLICY "Org owners can update members"
    ON organization_members FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
        )
        OR (
            organization_id IN (
                SELECT organization_id FROM organization_members
                WHERE user_id = auth.uid() AND role = 'owner'
            )
        )
    );

-- =============================================
-- 12. SEED DATA
-- =============================================

-- Insert enterprise domains
INSERT INTO enterprise_email_domains (domain, tier_id) VALUES
    ('snoopdrive.com', 'enterprise'),
    ('driveclub.io', 'enterprise')
ON CONFLICT (domain) DO NOTHING;

-- Note: Super admin user will be added after user signs up
-- Run this after shaun@snoopdrive.com signs up:
-- INSERT INTO admin_users (user_id, role)
-- SELECT id, 'super_admin' FROM auth.users WHERE email = 'shaun@snoopdrive.com'
-- ON CONFLICT (user_id) DO NOTHING;

-- =============================================
-- 13. HELPER FUNCTION TO ACCEPT INVITE
-- =============================================

CREATE OR REPLACE FUNCTION accept_invite(p_token VARCHAR(64), p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_invite RECORD;
    v_member_id UUID;
BEGIN
    -- Find the invite
    SELECT * INTO v_invite
    FROM user_invites
    WHERE token = p_token
    AND accepted_at IS NULL
    AND expires_at > NOW();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired invite');
    END IF;

    -- Check if user is already a member
    IF EXISTS (
        SELECT 1 FROM organization_members
        WHERE organization_id = v_invite.organization_id AND user_id = p_user_id
    ) THEN
        -- Update accepted_at even if already a member
        UPDATE user_invites SET accepted_at = NOW() WHERE id = v_invite.id;
        RETURN jsonb_build_object('success', true, 'message', 'Already a member');
    END IF;

    -- Add user to organization
    INSERT INTO organization_members (organization_id, user_id, role, invited_by)
    VALUES (v_invite.organization_id, p_user_id, v_invite.role, v_invite.invited_by)
    RETURNING id INTO v_member_id;

    -- Mark invite as accepted
    UPDATE user_invites SET accepted_at = NOW() WHERE id = v_invite.id;

    RETURN jsonb_build_object(
        'success', true,
        'member_id', v_member_id,
        'organization_id', v_invite.organization_id,
        'role', v_invite.role
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 14. GRANT PERMISSIONS
-- =============================================

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON admin_users TO service_role;
GRANT ALL ON enterprise_email_domains TO service_role;
GRANT ALL ON user_invites TO service_role;
GRANT ALL ON admin_audit_log TO service_role;
