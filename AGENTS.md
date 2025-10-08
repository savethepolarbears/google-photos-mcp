# Repository Guidelines

## Project Structure & Module Organization
Source lives under `src/`, with `src/index.ts` registering the MCP server and wiring routes. Feature logic is grouped by responsibility: `src/api/photos.ts` for Google Photos queries, `src/auth/` for OAuth helpers, `src/utils/` for shared helpers, and `src/views/` for response shaping. Generated JavaScript is emitted to `dist/` after builds. The `test-mcp/` directory contains a lightweight client harness you can use to exercise the server locally.

## Build, Test, and Development Commands
Install dependencies once with `npm install`. During authoring, run `npm run dev` to launch the TypeScript entrypoint through `ts-node` with live reload. `npm run build` transpiles to `dist/`, and `npm start` executes the compiled server. Lint the codebase via `npm run lint`, and format targeted files with `npm run format`. Use the test harness by running `npm install && npm start` inside `test-mcp/` to issue sample MCP requests.

## Coding Style & Naming Conventions
The project targets modern Node.js with ECMAScript modules and strict TypeScript types. Follow Prettier defaults (two-space indentation, single quotes) and run the formatter before sending a PR. ESLint extends `eslint:recommended` and `@typescript-eslint/recommended`; prefer explicit return types and keep `any` usage intentional. Name files and directories with kebab-case, exported classes in PascalCase, and internal utilities in camelCase. Keep environment variables in `.env` files mirroring keys from `.env.example`.

## Testing Guidelines
No automated test suite ships yet, so rely on the `test-mcp/` harness and manual validation against Google Photos. When adding tests, colocate them next to the module under test using the `*.spec.ts` suffix and keep assertions focused on JSON responses and error handling. Ensure new features include defensive checks for API quotas and expired tokens before manual QA sign-off.

## Commit & Pull Request Guidelines
Follow the existing history by writing concise, imperative commit subjects (for example, `Fix album listing pagination`). Group related changes together and avoid mixing refactors with feature work. Pull requests should outline the intent, list functional changes, mention any new environment variables, and describe manual verification steps. Attach screenshots or sample JSON when the change affects response payloads, and link relevant issues for traceability.

## Security & Configuration Tips
Never commit `.env`, OAuth credentials, or token files—`.gitignore` already covers them, but double-check before pushing. When testing locally, request minimal Google Photos scopes and revoke stale credentials from the Google Cloud Console. Rotate `tokens.json` entries if you hit permission errors, and document any new scopes or callbacks in `README.md` so downstream agents stay in sync.
