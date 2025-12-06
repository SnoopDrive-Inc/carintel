# Changelog

All notable changes to Car Intel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-12-05

### Added

- **API Foundation**
  - Vehicle lookup endpoint (`/lookup`) with Year/Make/Model/Trim search
  - VIN decoding endpoint (`/vin/:vin`) with NHTSA integration and Car Intel data matching
  - VIN decode-only endpoint (`/decode/:vin`) for raw NHTSA data
  - Vehicle specs search endpoint (`/specs`)
  - Vehicle-specific endpoints for specs, warranty, market value, and maintenance
  - Catalog endpoints for makes, models, and trims

- **Authentication & Rate Limiting**
  - API key authentication with SHA-256 hashed storage
  - Tiered rate limiting (Free: 10/min, Starter: 60/min, Pro: 300/min, Enterprise: 1000/min)
  - Distributed rate limiting via Upstash Redis
  - Usage tracking and monthly quota enforcement

- **MCP Server** (`@carintel/mcp`)
  - 10 tools for AI assistant integration
  - `lookup_vehicle` - Full vehicle lookup
  - `decode_vin` - VIN decoding
  - `get_vehicle_specs` - Detailed specifications
  - `get_market_value` - Market value estimates
  - `get_warranty_info` - Warranty coverage
  - `get_maintenance_schedule` - Maintenance schedule
  - `list_makes`, `list_models`, `list_trims`, `list_years` - Catalog browsing
  - stdio transport for Claude Desktop and Cursor integration

- **Database**
  - 79,988 vehicle specs records
  - 238,396 warranty records
  - 192,948 market value records
  - 1,667,538 maintenance schedule records
  - Organizations and API keys management
  - Usage logging and daily aggregates

### Security

- API keys are hashed with SHA-256 before storage
- Keys shown only once at creation time
- Environment-specific keys (`ci_live_*` and `ci_test_*`)
- Rate limiting prevents abuse
- RLS policies for data isolation
