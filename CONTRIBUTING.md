# Contributing to Google Photos MCP Server

Thank you for your interest in contributing to Google Photos MCP Server! We welcome contributions from the community.

Please take a moment to review this guide to ensure a smooth and effective contribution process.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please treat all contributors, reviewers, and maintainers with respect and professionalism.

---

## Getting Started

### Prerequisites

- **Node.js**: `v22.22.0` or higher
- **npm**: `v11.11.0` or higher
- A Google Cloud project with Google Photos Library API and/or Google Photos Picker API enabled (for local testing with real accounts).

### Local Setup

1. Fork the repository and clone your fork locally:

   ```bash
   git clone https://github.com/<your-username>/google-photos-mcp.git
   cd google-photos-mcp
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy environment configuration:

   ```bash
   cp .env.example .env
   ```

---

## Development Workflow

### Branching Strategy

- Always create short-lived feature or bugfix branches based on the latest `main` branch:

  ```bash
  git checkout main
  git pull origin main
  git checkout -b fix/your-bugfix-name
  # or
  git checkout -b feat/your-feature-name
  ```

- Never commit directly to `main`.
- Rebase onto `origin/main` rather than merging `main` into your feature branch to keep git history linear:

  ```bash
  git fetch origin
  git rebase origin/main
  ```

### Commit Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` A new feature or capability
- `fix:` A bug fix
- `docs:` Documentation-only changes
- `chore:` Maintenance, dependency updates, or tooling configuration
- `refactor:` Code changes that neither fix a bug nor add a feature
- `test:` Adding or updating tests

Keep commit subjects imperative and under 72 characters (e.g., `fix: correct oauth header conversion`).

---

## Mandatory Verification Checks

Before submitting a Pull Request, all of the following commands **must pass locally**:

```bash
# 1. Type-check without emitting
npx tsc --noEmit

# 2. Run ESLint across all files
npm run lint

# 3. Lint markdown documentation
npm run lint:md

# 4. Run test suite via Vitest
npm test

# 5. Verify Prettier formatting
npx prettier --check "src/**/*.ts"
```

---

## Security & Architecture Constraints

1. **No Secrets**: Never commit `.env` files, OAuth credentials, client secrets, access tokens, or refresh tokens.
2. **Strict Zod Validation**: All MCP tool handlers in `src/mcp/core.ts` must validate incoming arguments using Zod schemas defined in `src/schemas/toolSchemas.ts`.
3. **Transport Integrity**: Do not use `console.log` in code paths executed in STDIO mode (`npm run stdio`), as writing to stdout breaks the MCP protocol framing. Use the centralized `logger` utility (`src/utils/logger.ts`), which writes to stderr.
4. **No CORS Middleware**: CORS middleware was intentionally eliminated to safeguard local servers from unauthorized cross-origin requests. Local Express servers enforce DNS rebinding protection via `allowedHosts`.
5. **No `any` Types**: Avoid using TypeScript `any` without an explicit inline comment explaining the necessity.

---

## Submitting Pull Requests

1. Push your branch to your fork:

   ```bash
   git push origin feat/your-feature-name
   ```

2. Open a Pull Request targeting the `main` branch.
3. Fill out the PR description template:
   - **Why**: Describe the motivation and problem being solved.
   - **What**: Itemize the changes made.
   - **Testing**: Explain how the changes were verified locally.
4. Ensure all automated CI checks pass. Maintainers will review your PR and provide feedback.
