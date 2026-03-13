# Project Roadmap

## Phase 1: Foundation (Auth & Infrastructure)
**Objective**: Establish a secure, robust base for API interactions with proper token management, rate limiting, and error handling.
- **Requirements**: AUTH-01, AUTH-02, INFR-01, INFR-02, INFR-03
- **Plans:** 2/3 plans executed
- **Success Criteria**:
  - User can successfully authenticate via OAuth2 and tokens are persisted locally.
  - System correctly detects expired tokens and refreshes them seamlessly via Mutex.
  - System blocks requests exceeding the configured daily API quota.
  - Transient 5xx API errors are automatically retried using exponential backoff.
  - All critical operations and errors are written to Winston log files.

Plans:
- [ ] 01-01-PLAN.md — Wave 0: AUTH-01 vitest test scaffold + delete legacy test
- [ ] 01-02-PLAN.md — Wave 1: Migrate keytar to keyv/SQLite (AUTH-01 implementation)
- [ ] 01-03-PLAN.md — Wave 2: .gitignore hardening + full suite verification (AUTH-02, INFR-01-03)

## Phase 2: Core Read & Write Operations
**Objective**: Expose basic media and album management capabilities via standard MCP Tools and Resources.
- **Requirements**: READ-01, READ-02, READ-03, WRIT-01, WRIT-02, WRIT-03
- **Plans:** 6/6 plans complete
- **Success Criteria**:
  - AI can list and retrieve individual albums and media items via standard MCP tools.
  - Ephemeral media URLs are correctly abstracted behind stable MCP Resource URIs.
  - AI can create new albums and upload local byte streams successfully.
  - AI can add both existing and newly uploaded media items to designated albums.

Plans:
- [ ] 02-01-PLAN.md — Wave 0: TDD scaffold — failing tests for all READ-03 + WRIT-01/02/03 cases
- [ ] 02-02-PLAN.md — Wave 1: list_media_items tool — library-wide media listing (READ-01)
- [ ] 02-03-PLAN.md — Wave 1: MCP Resource handlers — google-photos:// URI scheme (READ-02, READ-03)
- [ ] 02-04-PLAN.md — Wave 2: create_album tool — album creation + appendonly scope activation (WRIT-01)
- [ ] 02-05-PLAN.md — Wave 2: upload_media tool — two-step raw byte upload + batchCreate (WRIT-02)
- [ ] 02-06-PLAN.md — Wave 2: add_media_to_album tool — batchAddMediaItems with 1-50 item validation (WRIT-03)

## Phase 3: Advanced API Coverage & Search
**Objective**: Implement 100% of the remaining API endpoints, including advanced search and sharing capabilities.
- **Requirements**: READ-04, FULL-01, FULL-02, FULL-03, FULL-04
- **Plans:** 2/3 plans executed
- **Success Criteria**:
  - AI can retrieve media items using simple date and category filters.
  - AI can execute advanced searches combining multiple criteria (e.g., date ranges + specific content categories).
  - AI can manage shared albums (share, join, leave, unshare).
  - AI can add text/location enrichments to albums and update their cover photos.

Plans:
- [ ] 03-01-PLAN.md — Wave 1: TDD scaffold — failing tests for all Phase 3 requirements (READ-04, FULL-01-04)
- [ ] 03-02-PLAN.md — Wave 2: search_media_by_filter tool + sharing stubs (READ-04, FULL-01, FULL-04)
- [ ] 03-03-PLAN.md — Wave 3: Album enrichment + cover photo tools + edit.appcreateddata scope (FULL-02, FULL-03)

## Phase 4: Composite Workflows & Metadata
**Objective**: Deliver high-level abstractions, automated enrichments, and multi-step workflows to reduce AI context overhead.
- **Requirements**: WORK-01, WORK-02, WORK-03, META-01
- **Success Criteria**:
  - AI can execute complex, multi-step actions (e.g., batch uploads) using a single composite tool.
  - Semantic abstractions enable the AI to easily construct valid Google Photos search queries.
  - MCP Prompts successfully guide AI agents on how to execute common organizational tasks.
  - Photo metadata is automatically enriched with human-readable locations from latitude/longitude data.
