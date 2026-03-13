# Google Photos API Limitation (March 31, 2025)

## Issue

As of March 31, 2025, Google deprecated full library access via the `photoslibrary.readonly` scope.

## Current Behavior

- ✅ **Authentication works** — OAuth flow completes successfully
- ✅ **Tokens are saved** — Stored securely in OS keychain
- ❌ **API calls fail with 403** — "Request had insufficient authentication scopes"

## Root Cause

The `https://www.googleapis.com/auth/photoslibrary.readonly` scope now only allows access to:

- Photos created by this app
- Albums created by this app

It **no longer provides access** to:

- User's full photo library
- User's existing albums
- Photos uploaded through Google Photos app/web

## Google's Recommendation

For full library access, Google recommends using:

- **Google Photos Picker API** — A different approach that requires user interaction

## Current Status

This MCP server is configured for the deprecated API scope and will only work with app-created content, making it essentially non-functional for browsing existing Google Photos libraries.

## Possible Solutions

1. **Switch to Photos Picker API** — Requires significant architectural changes
2. **Accept limitation** — Document that server only works with app-created content
3. **Request different scope** — Investigate if alternative scopes exist (unlikely)

## Date of Discovery

December 29, 2025

## References

- Config file: `src/utils/config.ts:54-64`
- Google Photos API deprecation date: March 31, 2025
