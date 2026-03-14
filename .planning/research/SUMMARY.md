# Project Research Summary

**Project:** Google Photos MCP Server
**Domain:** TypeScript/Node.js MCP Server
**Researched:** 2025-03-13
**Confidence:** HIGH

## Executive Summary

The Google Photos MCP Server is an autonomous, highly reliable TypeScript bridge allowing AI clients to interact with the Google Photos API via the Model Context Protocol. The recommended approach utilizes a strict Layered Architecture to separate the MCP transport mechanisms from complex business logic and exact REST API wrappers.

The primary value proposition lies in offering 100% API coverage coupled with sophisticated composite workflows (e.g., batch uploads, intelligent semantic searches) that reduce LLM context overhead. However, the system must navigate stringent Google API constraints, particularly the March 2025 scope deprecations, severe quota limits, and ephemeral media URLs that expire after 60 minutes.

By employing robust infrastructure components—such as a Mutex-protected TokenRefreshManager, a QuotaManager, and dynamic MCP Resources for media—the server will ensure "1000% reliability" without rate limit suspensions or state corruption.

## Key Findings

### Recommended Stack

The stack relies entirely on modern, standard TypeScript ecosystem tools, strongly favoring official Google libraries to maintain compatibility with their complex auth requirements.

**Core technologies:**
- **`typescript` (`^5.9.3`)**: Programming Language — Standard for robust, strongly-typed Node.js development.
- **`@modelcontextprotocol/sdk` (`^1.27.1`)**: MCP Framework — Official SDK for exposing tools, resources, and prompts.
- **`googleapis` (`^171.4.0`) & `google-auth-library` (`^10.6.1`)**: Google API Client — Ensures comprehensive access and robust OAuth2 token lifecycle management.
- **`zod` (`^4.3.6`) & `keyv` (`^5.6.0`)**: Supporting Libraries — For strict schema validation and secure, non-deprecated local token persistence.

### Expected Features

**Must have (table stakes):**
- Authentication & Authorization via OAuth2 with secure local token storage.
- Core Read Operations (List/Get Albums and Media, Search) exposed as Tools and Resources.
- Core Write Operations (Create Albums, Upload Media streams).
- Robust Rate Limiting & Error Handling.

**Should have (competitive):**
- 100% Complete API Coverage (Shared albums, enrichments, advanced filters).
- Composite Workflows (Advanced MCP Prompts & Tools) orchestrating multi-step API calls to save LLM context.
- Media Location Enrichment via geocoding (e.g., Nominatim).
- Enterprise-Grade Reliability & Quota Management tracking 10k requests/day.

**Defer (v2+ / Anti-features):**
- Graphical User Interface (GUI) or web dashboards.
- Full Local Synchronization / Database Scraping.
- File System Organization or Direct Video Streaming proxies.

### Architecture Approach

The application utilizes a strict Layered Architecture with clear boundaries, built bottom-up to ensure reliability. 

**Major components:**
1. **MCP Core (`src/mcp/core.ts`)** — Registers Tools, Resources, and Prompts; performs Zod validation and routes to services.
2. **Service Layer (`src/api/services/`)** — Orchestrates composite workflows mapping complex requests to multiple repository calls.
3. **Repository Layer (`src/api/repositories/`)** — 1:1 mapping to Google API endpoints, handling native pagination and payload formatting.
4. **Infrastructure (`src/auth/`, `src/utils/`)** — Manages Mutex-protected token refreshes, Quota tracking, and leveled logging.

### Critical Pitfalls

1. **Ignoring the March 2025 Scope Deprecation** — The `photoslibrary.readonly` scope is deprecated for full library access; the server must restrict LLM interactions to app-created content or handle strict permission boundaries.
2. **Ephemeral Media URL Expiration** — Google Photos `baseUrl` links expire after ~60 minutes. The server must implement MCP Resources that fetch bytes dynamically instead of letting the LLM save raw URLs.
3. **Rate Limiting & Quota Exhaustion** — The LLM cannot pace itself. `quotaManager.ts` must track every API call, and iteration logic should be handled server-side within composite workflows.
4. **LLM Pagination Mishandling** — LLMs frequently hallucinate page tokens or assume results end at 50 items. Pagination must be explicitly documented in schemas or abstracted entirely by the Service Layer.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Infrastructure & Auth Foundation
**Rationale:** A rock-solid foundation for API requests is required before any endpoints can be mapped.
**Delivers:** OAuth2 flows, Mutex-protected `TokenRefreshManager`, `quotaManager.ts`, and secure local storage (`keyv`).
**Addresses:** Authentication & Authorization, Robust Rate Limiting.
**Avoids:** Plaintext Token Backup Leaks, Rate Limiting & Quota Exhaustion.

### Phase 2: Repository Layer (API Wrappers)
**Rationale:** Establish stable 1:1 mappings with Google Photos API before building higher-level macro logic.
**Delivers:** `api/repositories/` covering Albums, MediaItems, Uploads with integrated retry logic.
**Uses:** `googleapis`, `axios`, `zod`.
**Implements:** Repository Layer.

### Phase 3: Domain Utilities & Service Layer
**Rationale:** Build the intelligent workflows that make the MCP server uniquely powerful for AI agents.
**Delivers:** Search filter builders, location enrichment integrations, and composite workflow functions (e.g., batch uploads).
**Addresses:** Composite Workflows, Media Location Enrichment.
**Avoids:** LLM Pagination Mishandling (by abstracting iteration server-side).

### Phase 4: MCP Core Integration
**Rationale:** Finally expose the thoroughly tested backend layers to the AI client protocol.
**Delivers:** `mcp/core.ts`, `schemas/toolSchemas.ts`, complete toolset, dynamic Resources, and instructional Prompts.
**Addresses:** Core Read/Write Operations, 100% Complete API Coverage.
**Avoids:** Ephemeral Media URL Expiration, Improper Resource Mapping for Volatile Data.

### Phase Ordering Rationale

- Building bottom-up (Auth -> Repo -> Service -> MCP) ensures that complex state management (tokens, quotas, retries) is rock solid before exposing tools to an unpredictable LLM.
- Handling repositories before services guarantees we understand the exact API payloads, error codes, and pagination limits before orchestrating them into macros.
- Avoids rate limit suspensions by integrating the QuotaManager (Phase 1) before testing live endpoints at scale (Phase 2).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3:** Location enrichment API limits (e.g., Nominatim strict usage policies) require careful investigation to implement proper fallback behaviors.
- **Phase 4:** Designing robust MCP Prompts that effectively constrain LLM hallucinations around paginated API bounds.

Phases with standard patterns (skip research-phase):
- **Phase 1 & 2:** Standard OAuth2 and REST wrapper implementations using official Google SDKs are well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Utilizes standard, heavily adopted TypeScript libraries and official SDKs. |
| Features | HIGH | Clear boundaries established between required API capabilities and out-of-scope LLM responsibilities. |
| Architecture | HIGH | Layered pattern is standard practice and perfectly suited for separating MCP transport from API logic. |
| Pitfalls | HIGH | Known Google API constraints (URLs, scopes, quotas) have been explicitly identified and mitigated. |

**Overall confidence:** HIGH

### Gaps to Address

- Exact operational limits of the `photoslibrary.readonly` scope deprecation for specific niche endpoints must be empirically validated during Phase 2 API tests to ensure no unexpected `403 Forbidden` errors occur.

## Sources

### Primary (HIGH confidence)
- Official Google Photos Library API Documentation — Verified for quotas, OAuth scopes, pagination, and URL expiration policies.
- @modelcontextprotocol/sdk documentation — Checked for best practices regarding Tools vs Resources vs Prompts.

### Secondary (MEDIUM confidence)
- Nominatim Usage Policy — Checked for basic rate limiting requirements for location enrichment.

---
*Research completed: 2025-03-13*
*Ready for roadmap: yes*
