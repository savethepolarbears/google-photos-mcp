## 2025-12-21 - Localhost CORS Configuration
**Vulnerability:** Overly permissive CORS (`*`) on a localhost MCP server allowed arbitrary websites to interact with the local server via the browser.
**Learning:** Local tools exposing HTTP servers often default to permissive CORS or no CORS, but when running on a developer's machine, they are vulnerable to drive-by attacks from malicious websites.
**Prevention:** Default to disabling CORS for local servers unless a specific web frontend requires it, and then strictly limit origins.
