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
3. **Secure Token Storage**: Authentication tokens are stored securely using OS-level keychain mechanisms (`keytar`) or encrypted SQLite rather than plaintext configuration files.
4. **Environment Isolation**: Sensitive configuration values and credentials are strictly loaded via `.env` and kept out of version control.
