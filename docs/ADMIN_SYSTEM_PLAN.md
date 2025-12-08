# Car Intel Admin System Implementation Plan

## Overview

This document outlines the implementation plan for a super admin system that allows `@snoopdrive.com` and `@driveclub.io` email users to have enterprise-tier access, with full admin capabilities for `shaun@snoopdrive.com`.

---

## 1. Database Schema Changes

### 1.1 New `admin_users` Table
```sql
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'admin', 'support')),
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id)
);
```

**Roles:**
- `super_admin`: Full access (shaun@snoopdrive.com)
- `admin`: Can manage orgs/users but not other admins
- `support`: Read-only access to orgs/users/usage

### 1.2 New `enterprise_email_domains` Table
```sql
CREATE TABLE enterprise_email_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(255) NOT NULL UNIQUE,
  tier_id VARCHAR(20) REFERENCES subscription_tiers(id) DEFAULT 'enterprise',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Initial domains
INSERT INTO enterprise_email_domains (domain, tier_id) VALUES
  ('snoopdrive.com', 'enterprise'),
  ('driveclub.io', 'enterprise');
```

### 1.3 Modify `organizations` Table
Add columns for admin management:
```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'suspended', 'revoked')),
  paused_at TIMESTAMPTZ,
  paused_by UUID REFERENCES auth.users(id),
  pause_reason TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  revoke_reason TEXT;
```

### 1.4 New `user_invites` Table
```sql
CREATE TABLE user_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.5 New `admin_audit_log` Table
Track all admin actions:
```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action VARCHAR(50) NOT NULL,
  target_type VARCHAR(50) NOT NULL, -- 'organization', 'user', 'api_key', etc.
  target_id UUID,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 2. Backend Functions

### 2.1 Auto-Assign Enterprise Tier
Create a database trigger that automatically assigns enterprise tier to users with allowed email domains:

```sql
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

CREATE TRIGGER org_auto_enterprise_tier
  BEFORE INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_enterprise_tier();
```

### 2.2 Admin Permission Check Function
```sql
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
```

---

## 3. Dashboard Pages

### 3.1 Admin Layout (`/admin/*`)
- Only accessible to users in `admin_users` table
- Navigation: Organizations | Users | Usage | Invites | Audit Log | Settings

### 3.2 Organizations Management (`/admin/organizations`)
**Features:**
- List all organizations with search/filter
- View org details: name, owner, tier, member count, API key count, usage
- Change subscription tier
- Pause/Resume organization access
- Revoke organization (permanent)
- View organization's API keys and usage

**Table Columns:**
| Name | Owner | Tier | Status | Members | API Keys | Usage (This Month) | Actions |

### 3.3 Users Management (`/admin/users`)
**Features:**
- List all users with search/filter
- View user details: email, organizations, role
- Change user's organization membership
- Invite user to organization
- Remove user from organization

**Table Columns:**
| Email | Organizations | Role | Last Active | Actions |

### 3.4 Usage Analytics (`/admin/usage`)
**Features:**
- Global usage stats across all organizations
- Filter by organization, date range, endpoint
- Export usage data (CSV)
- Usage trends chart

### 3.5 Invites Management (`/admin/invites`)
**Features:**
- Create new invites
- View pending invites
- Resend invite email
- Revoke pending invites

### 3.6 Audit Log (`/admin/audit`)
**Features:**
- View all admin actions
- Filter by admin, action type, date range
- Searchable

---

## 4. Organization Member Invites

### 4.1 Invite Flow
1. Admin/Owner clicks "Invite Member" in organization settings
2. Enter email and select role (admin or member)
3. System generates unique token and sends invite email
4. Recipient clicks link, signs up/logs in
5. Automatically added to organization with specified role

### 4.2 Invite Email Template
- Subject: "You've been invited to join [Org Name] on Car Intel"
- Body: Invitation details + accept link
- Expires in 7 days

### 4.3 Organization Settings Page Updates
Add "Members" section to `/settings`:
- List current members with roles
- Invite new members
- Remove members (admin only)
- Change member roles (admin only)

---

## 5. API Endpoints

### 5.1 Admin API Routes
```
GET    /api/admin/organizations        - List all orgs
GET    /api/admin/organizations/:id    - Get org details
PATCH  /api/admin/organizations/:id    - Update org (tier, status)
POST   /api/admin/organizations/:id/pause   - Pause org
POST   /api/admin/organizations/:id/resume  - Resume org
POST   /api/admin/organizations/:id/revoke  - Revoke org

GET    /api/admin/users                - List all users
GET    /api/admin/users/:id            - Get user details
POST   /api/admin/users/:id/invite     - Invite user to org

GET    /api/admin/usage                - Global usage stats
GET    /api/admin/usage/:orgId         - Org-specific usage

GET    /api/admin/invites              - List all invites
POST   /api/admin/invites              - Create invite
DELETE /api/admin/invites/:id          - Revoke invite

GET    /api/admin/audit                - Audit log
```

### 5.2 Organization Member API Routes
```
GET    /api/organizations/:id/members         - List members
POST   /api/organizations/:id/members/invite  - Invite member
DELETE /api/organizations/:id/members/:userId - Remove member
PATCH  /api/organizations/:id/members/:userId - Update member role
```

---

## 6. Security Considerations

### 6.1 RLS Policies
- Admin tables only accessible to admin users
- Audit log is append-only (no updates/deletes)
- Organization pause/revoke should block API access

### 6.2 API Key Validation Updates
Modify `validate_api_key` function to check organization status:
```sql
-- Add to validate_api_key function
IF v_org_record.status != 'active' THEN
  RETURN QUERY SELECT
    ..., false, 'organization_' || v_org_record.status;
  RETURN;
END IF;
```

### 6.3 Session Security
- Admin sessions should have shorter expiry
- Log all admin logins
- Consider 2FA for admin users (future)

---

## 7. Implementation Order

### Phase 1: Database & Core (Day 1-2)
1. Create migration for new tables
2. Add `auto_assign_enterprise_tier` trigger
3. Add `is_admin` function
4. Update `validate_api_key` for org status check
5. Add shaun@snoopdrive.com as super_admin
6. Add enterprise domains

### Phase 2: Admin Dashboard (Day 3-5)
1. Create admin layout with auth check
2. Implement Organizations page
3. Implement Users page
4. Implement Usage page
5. Implement Audit Log page

### Phase 3: Invites System (Day 6-7)
1. Create invite API endpoints
2. Add invite UI to admin dashboard
3. Add member management to organization settings
4. Implement invite acceptance flow
5. Set up email sending for invites

### Phase 4: Testing & Polish (Day 8)
1. End-to-end testing of all flows
2. Add loading states and error handling
3. Add confirmation dialogs for destructive actions
4. Review and fix any security issues

---

## 8. UI/UX Considerations

### 8.1 Admin Indicator
- Show admin badge in header when logged in as admin
- Different background color for admin pages

### 8.2 Confirmation Dialogs
Required for:
- Pausing organization
- Revoking organization
- Removing members
- Changing subscription tiers

### 8.3 Status Indicators
- Active: Green badge
- Paused: Yellow badge with "Paused" text
- Suspended: Orange badge
- Revoked: Red badge with strikethrough

---

## 9. Future Enhancements

1. **Email notifications** for org status changes
2. **Bulk actions** (pause multiple orgs, bulk invite)
3. **Role-based dashboard views** (support sees read-only)
4. **Two-factor authentication** for admins
5. **API rate limit overrides** per organization
6. **Custom enterprise features** toggle per org
7. **Billing integration** with Stripe for paid tiers
8. **Usage alerts** when approaching limits
