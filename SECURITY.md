# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability within this project, please **do not** open a public issue. Publicly disclosing a vulnerability can endanger users before a fix can be prepared and released.

### Vulnerability Reporting Process

1. Report the issue confidentially via **GitHub Private Vulnerability Reporting**:
   - Navigate to the **Security** tab of the repository on GitHub.
   - Click on **Report a vulnerability** to submit an advisory draft.
2. Alternatively, reach out directly to the maintainers at: `security@blackbearmedia.io`.
3. Please provide the following details in your report:
   - Description of the vulnerability and its potential impact.
   - Steps to reproduce or proof-of-concept (PoC).
   - Any suggested mitigations or patches.

We will acknowledge receipt of your vulnerability report within 48 hours and coordinate a coordinated remediation release.

---

## Supported Versions

Only the latest release on the `main` branch is actively supported with security patches.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1.0 | No        |

---

## Architectural Security Safeguards

This server implements several proactive defense-in-depth measures:

1. **Local DNS Rebinding Protection**: The HTTP server restricts allowed Host headers to `127.0.0.1` and `[::1]`.
2. **Absence of CORS Middleware**: Cross-Origin Resource Sharing is intentionally disabled to prevent malicious web pages in the user's browser from issuing cross-origin requests to the local MCP server.
3. **Local Token Storage & Permission Hardening**: Authentication tokens are stored locally in SQLite (`tokens.db` via `@keyv/sqlite`) as JSON documents. Restrictive owner-only permissions (`0600` on Unix, explicit owner-only ACLs via `icacls.exe` on Windows) are automatically enforced on the database file and any journaling sidecars (`-wal`, `-shm`, `-journal`), with `0700` (or container-inherit user ACL on Windows) enforced on newly created token directories. In shared checkouts or multi-user environments, inherited permissions are stripped to ensure other local users cannot read stored OAuth credentials. The database file is excluded from version control via `.gitignore`, and token values are never emitted to logs.
4. **Environment Isolation**: Sensitive configuration values and credentials are strictly loaded via `.env` and kept out of version control.
5. **Media Download Origin Validation & SSRF Prevention**: The `download_picker_media` tool strictly validates that all download base URLs use HTTPS and belong exclusively to trusted Google Photos media domains (`*.googleusercontent.com`, `*.photos.google.com`, `photoslibrary.googleapis.com`), eliminating SSRF and token exfiltration risks.
6. **Memory Exhaustion Safeguards**: In-memory base64 responses are strictly capped at 10MB to avoid Node.js heap exhaustion; `savePath` enables direct-to-disk streaming with O(1) heap memory overhead for large media and videos.
