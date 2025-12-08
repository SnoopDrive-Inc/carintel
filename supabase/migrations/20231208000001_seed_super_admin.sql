-- =============================================
-- SEED SUPER ADMIN
-- Run this after shaun@snoopdrive.com signs up
-- =============================================

-- Add super admin for shaun@snoopdrive.com
-- This will run when the migration is applied
-- If the user doesn't exist yet, it will do nothing

INSERT INTO admin_users (user_id, role, created_by)
SELECT id, 'super_admin', id
FROM auth.users
WHERE email = 'shaun@snoopdrive.com'
ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin';

-- Also make sure their organization is enterprise tier
UPDATE organizations
SET subscription_tier_id = 'enterprise'
WHERE owner_user_id IN (
    SELECT id FROM auth.users WHERE email = 'shaun@snoopdrive.com'
);
