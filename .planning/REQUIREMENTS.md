# Requirements: Google Photos MCP Server

**Defined:** 2026-03-13
**Core Value:** 1000% reliability and complete API coverage wrapped in modern MCP best practices, enabling AI agents to effortlessly and securely manage Google Photos media.

## v1 Requirements

### Authentication & Infrastructure
- [x] **AUTH-01**: User can securely authenticate via Google OAuth2 with `keyv` local token storage.
- [ ] **AUTH-02**: System automatically refreshes OAuth tokens using a Mutex to prevent race conditions.
- [ ] **INFR-01**: System precisely tracks the 10,000 requests/day API quota.
- [ ] **INFR-02**: System implements exponential backoff and retry mechanisms for transient API failures.
- [ ] **INFR-03**: System provides detailed Winston-based logging for transparent agent debugging.

### Core Read Operations & Resources
- [ ] **READ-01**: AI can List Albums and List Media Items via tools.
- [ ] **READ-02**: AI can Get specific Album by ID and Get specific Media Item by ID.
- [ ] **READ-03**: System exposes albums and media as dynamic MCP Resources (e.g., `google-photos://albums/{id}`) to handle ephemeral URLs.
- [x] **READ-04**: AI can search media by basic parameters (date, category).

### Core Write Operations
- [ ] **WRIT-01**: AI can create new Albums.
- [ ] **WRIT-02**: AI can upload media files (byte streams).
- [ ] **WRIT-03**: AI can add existing or newly uploaded media to specific Albums.

### 100% Complete API Coverage
- [x] **FULL-01**: AI can manage shared albums (join, leave, share, unshare).
- [x] **FULL-02**: AI can manage album enrichments (add text/location to albums).
- [x] **FULL-03**: AI can set album cover photos.
- [x] **FULL-04**: AI can perform advanced media search using complex filters (date ranges, specific content categories like `PETS` or `LANDSCAPES`).

### Composite Workflows & Prompts
- [x] **WORK-01**: System provides high-level abstractions that batch or orchestrate multiple API calls efficiently (e.g., "Create an album and upload these 10 local files").
- [x] **WORK-02**: System provides semantic abstractions for AI to natively understand Google Photos filter constructs.
- [ ] **WORK-03**: System exposes MCP Prompts to guide AI agents on how to organize, tag, or retrieve complex sets of photos.

### Metadata Enrichment
- [x] **META-01**: System automatically enriches photo metadata by converting latitude/longitude to human-readable locations.

## v2 Requirements

(None currently deferred. Full scope requested for v1.)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Graphical User Interface (GUI) | Strictly an MCP server designed to be consumed by AI clients. |
| Full Local Synchronization / DB Scraping | Costs too many API calls, violates API TOS constraints, and duplicates state unnecessarily. Data remains in the cloud. |
| File System Organization | Server is a bridge to the cloud. AI agent consuming the server is responsible for interfacing with local file system tools. |
| Direct Video Streaming Proxy | AI agent or host application can use Google Photos base URLs directly; proxying heavy video streams is inefficient. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Pending |
| INFR-01 | Phase 1 | Pending |
| INFR-02 | Phase 1 | Pending |
| INFR-03 | Phase 1 | Pending |
| READ-01 | Phase 2 | Pending |
| READ-02 | Phase 2 | Pending |
| READ-03 | Phase 2 | Pending |
| READ-04 | Phase 3 | Complete |
| WRIT-01 | Phase 2 | Pending |
| WRIT-02 | Phase 2 | Pending |
| WRIT-03 | Phase 2 | Pending |
| FULL-01 | Phase 3 | Complete |
| FULL-02 | Phase 3 | Complete |
| FULL-03 | Phase 3 | Complete |
| FULL-04 | Phase 3 | Complete |
| WORK-01 | Phase 4 | Complete |
| WORK-02 | Phase 4 | Complete |
| WORK-03 | Phase 4 | Pending |
| META-01 | Phase 4 | Complete |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-03-13*
*Last updated: 2026-03-13 after initial definition*
