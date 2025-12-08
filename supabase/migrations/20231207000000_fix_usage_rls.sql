-- =============================================
-- FIX RLS POLICIES FOR USAGE TABLES
-- Allow service role to insert, org owners to read
-- =============================================

-- Usage logs - org owners can read their logs
DROP POLICY IF EXISTS "Users can read their org usage logs" ON usage_logs;
CREATE POLICY "Users can read their org usage logs"
    ON usage_logs FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

-- Usage daily - org owners can read their daily usage
DROP POLICY IF EXISTS "Users can read their org daily usage" ON usage_daily;
CREATE POLICY "Users can read their org daily usage"
    ON usage_daily FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

-- Note: INSERT policies for usage tables are not needed because
-- the Edge Functions use the service_role key which bypasses RLS
