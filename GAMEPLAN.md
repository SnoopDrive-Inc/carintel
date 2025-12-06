# Car Intel - Strategic Gameplan

## Executive Summary

**Car Intel** is a paid data platform providing comprehensive vehicle information (specs, warranties, market values, maintenance schedules, and repair estimates) via API, MCP (Model Context Protocol), and CLI. The platform enables AI applications, automotive services, and developers to access structured vehicle data through a unified, metered service.

**Domain**: carintel.io

**Target Customers:**
1. **Blume/DriveClub App** - Primary customer, replacing internal vehicle_specs/warranty tables
2. **DriveClub AI Chatbot** - OpenAI Agent Kit integration via API
3. **Third-party developers** - AI assistants, automotive apps, dealership software

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Car Intel                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │    CLI      │    │    MCP      │    │    API      │                  │
│  │ (Developer  │    │  (Claude,   │    │  (REST +    │                  │
│  │   Tools)    │    │   Cursor)   │    │   OpenAI)   │                  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                  │
│         │                  │                   │                         │
│         └──────────────────┼───────────────────┘                         │
│                            │                                             │
│                            ▼                                             │
│              ┌─────────────────────────┐                                 │
│              │    Supabase Edge        │                                 │
│              │      Functions          │                                 │
│              │  ┌─────────────────┐    │                                 │
│              │  │ Auth + API Keys │    │                                 │
│              │  │ Rate Limiting   │    │                                 │
│              │  │ Usage Tracking  │    │                                 │
│              │  └─────────────────┘    │                                 │
│              └───────────┬─────────────┘                                 │
│                          │                                               │
│                          ▼                                               │
│              ┌─────────────────────────┐                                 │
│              │   Supabase PostgreSQL   │                                 │
│              │  ┌───────────────────┐  │                                 │
│              │  │ vehicle_specs     │  │                                 │
│              │  │ vehicle_warranties│  │                                 │
│              │  │ market_values     │  │                                 │
│              │  │ maintenance       │  │                                 │
│              │  │ repair_estimates  │  │                                 │
│              │  │ api_keys          │  │                                 │
│              │  │ usage_logs        │  │                                 │
│              │  │ subscriptions     │  │                                 │
│              │  └───────────────────┘  │                                 │
│              └─────────────────────────┘                                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Schema

### Current Tables (Imported)

| Table | Rows | Description |
|-------|------|-------------|
| `vehicle_specs` | 79,988 | Year/make/model/trim with full specifications |
| `vehicle_warranties` | 238,396 | Warranty coverage by vehicle |
| `vehicle_market_values` | 192,948 | Values by condition (trade-in, private party, dealer) |
| `vehicle_maintenance_schedules` | 1,667,538 | Service items by mileage interval |

### New Tables Required

```sql
-- API Key Management
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 of actual key
    key_prefix VARCHAR(12) NOT NULL, -- "vi_live_abc..." for display
    environment VARCHAR(10) NOT NULL CHECK (environment IN ('live', 'test')),
    scopes TEXT[] DEFAULT ARRAY['read'], -- Future: 'write', 'admin'
    rate_limit_per_minute INTEGER DEFAULT 60,
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP -- NULL = never expires
);

-- Organizations/Customers
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    owner_user_id UUID REFERENCES auth.users(id),
    stripe_customer_id VARCHAR(100),
    subscription_tier VARCHAR(20) DEFAULT 'free',
    subscription_status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Usage Tracking
CREATE TABLE usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES api_keys(id),
    organization_id UUID REFERENCES organizations(id),
    endpoint VARCHAR(100) NOT NULL,
    method VARCHAR(10) NOT NULL,
    source VARCHAR(20) NOT NULL, -- 'api', 'mcp', 'cli'
    request_params JSONB,
    response_status INTEGER,
    tokens_used INTEGER DEFAULT 1, -- For billing
    latency_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Daily Usage Aggregates (for fast billing queries)
CREATE TABLE usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    date DATE NOT NULL,
    source VARCHAR(20) NOT NULL,
    endpoint VARCHAR(100) NOT NULL,
    request_count INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    UNIQUE(organization_id, date, source, endpoint)
);

-- Subscription Tiers
CREATE TABLE subscription_tiers (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    monthly_price_cents INTEGER NOT NULL,
    monthly_token_limit INTEGER, -- NULL = unlimited
    rate_limit_per_minute INTEGER NOT NULL,
    features JSONB,
    stripe_price_id VARCHAR(100)
);

-- Initial tiers
INSERT INTO subscription_tiers VALUES
    ('free', 'Free', 0, 1000, 10, '{"api": true, "mcp": true, "cli": true}', NULL),
    ('starter', 'Starter', 4900, 50000, 60, '{"api": true, "mcp": true, "cli": true, "support": "email"}', 'price_starter'),
    ('pro', 'Pro', 19900, 500000, 300, '{"api": true, "mcp": true, "cli": true, "support": "priority"}', 'price_pro'),
    ('enterprise', 'Enterprise', 0, NULL, 1000, '{"api": true, "mcp": true, "cli": true, "support": "dedicated", "sla": true}', NULL);
```

### Data Optimization for API/MCP

Current schema is optimized for read-heavy workloads:

1. **Denormalized YMMT** - Year/make/model/trim duplicated across tables for fast single-query lookups without joins
2. **TEXT[] arrays** - Service items stored as arrays, not junction tables (reduces joins from 15M+ to 1.6M rows)
3. **Indexes** - B-tree indexes on YMMT columns for fast vehicle lookups
4. **Values in cents** - Integer storage for currency avoids floating-point issues

**Recommended additions:**
- Full-text search index on make/model for fuzzy matching
- Materialized view for "vehicle summary" combining all data types
- GIN index on service_items array for containment queries

---

## API Design

### Base URL
```
https://api.carintel.io/v1
```

### Authentication
```
Authorization: Bearer ci_live_xxxxxxxxxxxxx
```

### Core Endpoints

```
GET  /vehicles/lookup
     ?year=2024&make=Toyota&model=Camry&trim=XSE
     Returns: specs, warranty, market_value, maintenance (combined)

GET  /vehicles/specs
     ?year=2024&make=Toyota&model=Camry
     Returns: Array of matching vehicle specs

GET  /vehicles/{id}/specs
     Returns: Single vehicle spec by ID

GET  /vehicles/{id}/warranty
     Returns: Warranty information

GET  /vehicles/{id}/market-value
     ?mileage=50000&condition=Average
     Returns: Adjusted market values

GET  /vehicles/{id}/maintenance
     ?current_mileage=45000
     Returns: Upcoming maintenance schedule

GET  /vehicles/{id}/maintenance/history
     Returns: All maintenance intervals up to current mileage

GET  /makes
     Returns: List of all makes

GET  /makes/{make}/models
     ?year=2024
     Returns: List of models for make

GET  /makes/{make}/models/{model}/trims
     ?year=2024
     Returns: List of trims

# Future (when repair estimates imported)
GET  /vehicles/{id}/repair-estimate
     ?repair_type=brake_pads
     Returns: Parts, labor, and total costs
```

### Response Format

```json
{
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "tokens_used": 1,
    "tokens_remaining": 49999
  }
}
```

### Error Format

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit of 60 requests/minute exceeded",
    "retry_after": 45
  }
}
```

---

## MCP Implementation

### Tools

Based on Flux patterns, define MCP tools as operations AI assistants can invoke:

```typescript
const tools = [
  {
    name: "lookup_vehicle",
    description: "Look up complete vehicle information by year, make, model, and optional trim",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Vehicle model year" },
        make: { type: "string", description: "Vehicle manufacturer" },
        model: { type: "string", description: "Vehicle model name" },
        trim: { type: "string", description: "Vehicle trim level (optional)" }
      },
      required: ["year", "make", "model"]
    }
  },
  {
    name: "get_market_value",
    description: "Get market value for a vehicle based on condition and mileage",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
        trim: { type: "string" },
        condition: {
          type: "string",
          enum: ["Outstanding", "Clean", "Average", "Rough"]
        },
        mileage: { type: "number", description: "Current odometer reading" }
      },
      required: ["year", "make", "model", "condition"]
    }
  },
  {
    name: "get_maintenance_schedule",
    description: "Get maintenance schedule for a vehicle, optionally filtered by current mileage",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
        trim: { type: "string" },
        current_mileage: { type: "number", description: "Current odometer to show upcoming services" }
      },
      required: ["year", "make", "model"]
    }
  },
  {
    name: "get_warranty_info",
    description: "Get warranty coverage information for a vehicle",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
        trim: { type: "string" }
      },
      required: ["year", "make", "model"]
    }
  },
  {
    name: "search_vehicles",
    description: "Search for vehicles by partial make/model name",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (e.g., 'toyota cam')" },
        year_min: { type: "number" },
        year_max: { type: "number" }
      },
      required: ["query"]
    }
  }
];
```

### MCP Server Modes

1. **Local (stdio)** - For Claude Desktop, Cursor
   - Reads API key from `~/.vehicle-intel/config.json`
   - Communicates via stdin/stdout

2. **Remote (SSE)** - For web-based AI platforms
   - Cloudflare Worker or Supabase Edge Function
   - Server-sent events transport

### Configuration (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "carintel": {
      "command": "npx",
      "args": ["-y", "@carintel/mcp"],
      "env": {
        "CARINTEL_API_KEY": "ci_live_xxxxx"
      }
    }
  }
}
```

---

## CLI Implementation

### Commands

```bash
# Authentication
carintel login              # OAuth login, stores session
carintel logout             # Clear session
carintel whoami             # Show current user/org

# API Key Management
carintel keys list          # List API keys
carintel keys create        # Create new key
carintel keys revoke <id>   # Revoke a key

# Usage & Billing
carintel usage              # Show current period usage
carintel usage --detailed   # Breakdown by endpoint
carintel subscribe          # Open subscription page
carintel billing            # Open billing portal

# Data Queries (for testing/development)
carintel lookup 2024 Toyota Camry XSE
carintel market-value 2024 Toyota Camry --condition Average --mileage 50000
carintel maintenance 2024 Toyota Camry --mileage 45000
carintel warranty 2024 Toyota Camry

# Configuration
carintel config set api_key <key>
carintel config get api_key
```

### Session Storage

```
~/.carintel/
├── config.json      # API key, preferences
└── session.json     # OAuth tokens (if using user auth)
```

---

## Usage Tracking & Billing

### Tracking Flow

1. Every API request includes `X-Client-Source` header (api/mcp/cli)
2. Edge function middleware:
   - Validates API key
   - Checks rate limits
   - Logs to `usage_logs` table
   - Increments `usage_daily` aggregate
3. End of billing period:
   - Aggregate usage from `usage_daily`
   - Bill overage via Stripe if applicable

### Rate Limiting Strategy

Using Upstash Redis with sliding window algorithm for distributed rate limiting:

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: Deno.env.get('UPSTASH_REDIS_REST_URL'),
  token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN'),
});

const rateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(limit, '1 m'),
  prefix: 'carintel_ratelimit',
});

const { success, remaining, reset } = await rateLimiter.limit(organizationId);
```

**Rate Limits by Tier:**
| Tier | Requests/Minute |
|------|-----------------|
| Free | 10 |
| Starter | 60 |
| Pro | 300 |
| Enterprise | 1000 |

### Stripe Integration

```typescript
// Subscription tiers map to Stripe Price IDs
const STRIPE_PRICES = {
  starter: 'price_starter_monthly',
  pro: 'price_pro_monthly'
};

// Webhook handlers
- customer.subscription.created -> Update org.subscription_tier
- customer.subscription.updated -> Update org.subscription_tier
- customer.subscription.deleted -> Downgrade to free
- invoice.payment_failed -> Mark subscription_status as 'past_due'
```

---

## Documentation Strategy

### OpenAPI Specification

Auto-generate OpenAPI 3.0 spec from API implementation:

```yaml
openapi: 3.0.3
info:
  title: Car Intel API
  version: 1.0.0
  description: Vehicle data API for AI applications and automotive services
servers:
  - url: https://api.carintel.io/v1
paths:
  /vehicles/lookup:
    get:
      summary: Look up complete vehicle information
      parameters:
        - name: year
          in: query
          required: true
          schema:
            type: integer
        - name: make
          in: query
          required: true
          schema:
            type: string
        # ... etc
```

### Documentation Site (Scalar)

Using [Scalar](https://scalar.com) for API documentation:

- **Free & self-hosted** - Single HTML file or npm package
- **Interactive API explorer** - Test endpoints directly
- **Beautiful UI** - Modern, dark mode support
- **OpenAPI native** - Auto-generates from spec

```bash
# Installation
npm install @scalar/api-reference

# Or use CDN
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
```

Deploy as static site to Vercel/Netlify at `docs.carintel.io`.

### Changelog Management (Release Please)

Automated changelog generation from conventional commits:

```yaml
# .github/workflows/release-please.yml
name: Release Please
on:
  push:
    branches: [main]
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: google-github-actions/release-please-action@v4
        with:
          release-type: node
          package-name: "@carintel/api"
```

**Commit format:**
- `feat: add VIN decoding endpoint` → Minor version bump
- `fix: correct market value calculation` → Patch version bump
- `feat!: change API response format` → Major version bump

### Documentation Components

1. **API Reference** (`docs.carintel.io`)
   - OpenAPI-powered interactive docs
   - Code samples in multiple languages
   - Authentication guide

2. **CHANGELOG.md**
   - Auto-generated from commits
   - Versioned release notes
   - Breaking change alerts

3. **Integration Guides**
   - Quick start (5 minutes)
   - MCP setup for Claude/Cursor
   - SDK usage examples

---

## Customer Dashboard

Simple Next.js portal for API key management and usage viewing:

### Features

1. **Authentication**
   - Supabase Auth (email/password, OAuth)
   - Organization management

2. **API Key Management**
   - Create/revoke API keys
   - View key prefix and creation date
   - Set key names/labels
   - Copy full key (shown once)

3. **Usage Dashboard**
   - Current period usage vs limit
   - Usage by endpoint breakdown
   - Request history (recent 100)
   - Rate limit status

4. **Billing** (Phase 4)
   - Current plan display
   - Upgrade/downgrade via Stripe
   - Invoice history

### Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Auth**: Supabase Auth
- **Database**: Direct Supabase queries (RLS protected)
- **Styling**: Tailwind CSS + shadcn/ui
- **Charts**: Recharts for usage graphs
- **Deployment**: Vercel

### Routes

```
/                    → Dashboard (usage overview)
/keys                → API key management
/keys/new            → Create new key
/usage               → Detailed usage analytics
/settings            → Organization settings
/billing             → Subscription management
```

---

## Implementation Phases

### Phase 1: API Foundation ✅
- [x] Create `organizations`, `api_keys`, `subscription_tiers` tables
- [x] Create `usage_logs`, `usage_daily` tables
- [x] Build Edge Function for API gateway with:
  - [x] API key validation
  - [x] Rate limiting (Upstash Redis)
  - [x] Usage logging
- [x] Implement core endpoints:
  - [x] `GET /vehicles/lookup`
  - [x] `GET /vehicles/vin/:vin`
  - [x] `GET /makes`, `/makes/{make}/models`, etc.
- [x] Deploy to Supabase Edge Functions

### Phase 2: MCP Server ✅
- [x] Create `@carintel/mcp` package
- [x] Implement MCP tools calling API
- [x] Add stdio transport for local use
- [ ] Publish to npm
- [ ] Write setup guide for Claude Desktop/Cursor

### Phase 3: Documentation
- [ ] Generate OpenAPI spec from current API
- [ ] Create CHANGELOG.md
- [ ] Set up Release Please GitHub Action
- [ ] Deploy Scalar docs site at `docs.carintel.io`
- [ ] Write quick start guide

### Phase 4: Customer Dashboard
- [ ] Set up Next.js project at `dashboard.carintel.io`
- [ ] Implement Supabase Auth
- [ ] Build API key management UI
- [ ] Build usage dashboard with charts
- [ ] Deploy to Vercel

### Phase 5: CLI
- [ ] Create `@carintel/cli` package
- [ ] Implement OAuth login flow
- [ ] Add key management commands
- [ ] Add usage/billing commands
- [ ] Add data query commands (lookup, market-value, etc.)
- [ ] Publish to npm

### Phase 6: Billing Integration
- [ ] Set up Stripe products and prices
- [ ] Create Stripe checkout session endpoint
- [ ] Implement webhook handlers
- [ ] Build customer portal integration
- [ ] Add overage billing logic

### Phase 7: Blume Integration
- [ ] Create Blume organization and API key
- [ ] Update Blume backend to use Car Intel API
- [ ] Remove internal vehicle_specs/warranty tables from Blume
- [ ] Test and validate data parity

### Phase 8: DriveClub AI Chatbot
- [ ] Set up OpenAI Agent Kit project
- [ ] Configure Car Intel as function calling tool
- [ ] Build conversation flows for vehicle queries
- [ ] Deploy chatbot

### Phase 9: Polish & Launch
- [ ] Landing page at `carintel.io`
- [ ] Marketing to automotive/AI developers
- [ ] ProductHunt launch

---

## Blume/DriveClub Integration Details

### Current State (Blume)
Blume has internal tables for vehicle data. Replace with API calls:

```typescript
// Before (direct DB query)
const specs = await db.query('SELECT * FROM vehicle_specs WHERE year = ? AND make = ?', [year, make]);

// After (Car Intel API)
const response = await fetch('https://api.carintel.io/v1/vehicles/specs?' +
  new URLSearchParams({ year, make }), {
  headers: { 'Authorization': `Bearer ${CARINTEL_API_KEY}` }
});
const { data: specs } = await response.json();
```

### SDK Option

Create `@carintel/sdk` for cleaner integration:

```typescript
import { CarIntel } from '@carintel/sdk';

const ci = new CarIntel({ apiKey: process.env.CARINTEL_API_KEY });

// Type-safe methods
const vehicle = await ci.lookup({ year: 2024, make: 'Toyota', model: 'Camry' });
const value = await ci.getMarketValue({ year: 2024, make: 'Toyota', model: 'Camry', condition: 'Average' });
```

---

## OpenAI Agent Kit Integration

### Function Definitions

```typescript
const functions = [
  {
    name: "get_vehicle_info",
    description: "Get comprehensive information about a vehicle including specs, warranty, market value, and maintenance schedule",
    parameters: {
      type: "object",
      properties: {
        year: { type: "integer", description: "The model year of the vehicle" },
        make: { type: "string", description: "The manufacturer (e.g., Toyota, Ford)" },
        model: { type: "string", description: "The model name (e.g., Camry, F-150)" },
        trim: { type: "string", description: "The trim level (optional)" },
        mileage: { type: "integer", description: "Current odometer reading for value/maintenance calculations" },
        condition: {
          type: "string",
          enum: ["Outstanding", "Clean", "Average", "Rough"],
          description: "Vehicle condition for market value"
        }
      },
      required: ["year", "make", "model"]
    }
  }
];
```

### Implementation

```typescript
async function handleFunctionCall(name: string, args: any) {
  if (name === 'get_vehicle_info') {
    const response = await fetch(
      `https://api.carintel.io/v1/vehicles/lookup?` + new URLSearchParams(args),
      { headers: { 'Authorization': `Bearer ${API_KEY}` } }
    );
    return response.json();
  }
}
```

---

## Security Considerations

1. **API Key Storage**
   - Store only SHA-256 hash in database
   - Show full key only once at creation
   - Prefix keys for easy identification (`ci_live_`, `ci_test_`)

2. **Rate Limiting**
   - Per-key limits prevent abuse
   - Tier-based limits encourage upgrades
   - Burst protection for spike traffic

3. **Data Access**
   - Read-only API (no mutations)
   - RLS policies ensure data isolation
   - Audit logging for compliance

4. **Transport Security**
   - HTTPS only
   - HSTS headers
   - API versioning for breaking changes

---

## Monitoring & Observability

1. **Metrics**
   - Request latency (p50, p95, p99)
   - Error rates by endpoint
   - Usage by organization
   - Rate limit hits

2. **Alerts**
   - Error rate > 1%
   - Latency p95 > 500ms
   - Database connection pool exhaustion
   - Unusual usage patterns (potential abuse)

3. **Dashboards**
   - Real-time request volume
   - Revenue by tier
   - Top organizations by usage
   - Geographic distribution

---

## Cost Analysis

### Supabase Costs (Pro Plan: $25/mo)
- Database: 8GB included
- Edge Functions: 500K invocations included
- Bandwidth: 250GB included

### Estimated Margins

| Tier | Price | Est. Requests | Cost to Serve | Margin |
|------|-------|---------------|---------------|--------|
| Free | $0 | 1,000/mo | ~$0.01 | N/A |
| Starter | $49 | 50,000/mo | ~$0.50 | 99% |
| Pro | $199 | 500,000/mo | ~$5.00 | 97% |
| Enterprise | Custom | Unlimited | Negotiated | 80%+ |

---

## Open Questions

1. ~~**Naming**: "Vehicle Intelligence" vs alternatives~~ → **Car Intel** (carintel.io)
2. ~~**Domain**~~ → **carintel.io** (registered)
3. **Free tier limits**: 1,000 requests/month sufficient?
4. **Enterprise pricing**: Per-request vs flat rate?
5. **Data updates**: How to keep market values current?
6. **Repair estimates**: Import remaining data from vehicledatabases.com (contact support to re-download)

---

## Next Steps

1. **Immediate**: Create API key/organization/usage tables migration
2. **This week**: Build API gateway Edge Function
3. **Contact**: vehicledatabases.com to re-download repair estimates file
4. **Decide**: Final product name and domain
