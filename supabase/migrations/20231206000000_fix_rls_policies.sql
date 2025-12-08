-- =============================================
-- FIX RLS POLICIES FOR DASHBOARD
-- Allow org owners to create/read data
-- =============================================

-- Allow users to create organizations (they become owner)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Users can create organizations' AND tablename = 'organizations'
    ) THEN
        CREATE POLICY "Users can create organizations"
            ON organizations FOR INSERT
            WITH CHECK (owner_user_id = auth.uid());
    END IF;
END $$;

-- Allow organization owners to insert API keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Org owners can create API keys' AND tablename = 'api_keys'
    ) THEN
        CREATE POLICY "Org owners can create API keys"
            ON api_keys FOR INSERT
            WITH CHECK (
                organization_id IN (
                    SELECT id FROM organizations WHERE owner_user_id = auth.uid()
                )
            );
    END IF;
END $$;

-- Fix read policy for API keys to include org owner
DROP POLICY IF EXISTS "Users can read their org API keys" ON api_keys;
CREATE POLICY "Users can read their org API keys"
    ON api_keys FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

-- Fix read policy for organizations to handle owner case better
DROP POLICY IF EXISTS "Users can read their organizations" ON organizations;
CREATE POLICY "Users can read their organizations"
    ON organizations FOR SELECT
    USING (
        owner_user_id = auth.uid()
        OR id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
    );

-- Allow org owners to update their API keys (revoke)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Org owners can update API keys' AND tablename = 'api_keys'
    ) THEN
        CREATE POLICY "Org owners can update API keys"
            ON api_keys FOR UPDATE
            USING (
                organization_id IN (
                    SELECT id FROM organizations WHERE owner_user_id = auth.uid()
                )
            );
    END IF;
END $$;
