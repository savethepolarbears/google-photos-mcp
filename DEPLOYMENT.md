# Remote MCP deployment (work in progress)

This remote mode is under development and has not yet been validated against a real Google account or a production reverse proxy. Do not expose it publicly until those checks and the remaining security review are complete.

The intended resource URL is `https://photos-mcp.kernelkicks.dev/mcp`. It uses OAuth authorization code with PKCE and dynamic client registration. Google OAuth is a separate account-linking step; the server associates credentials with Google's verified subject. Google Photos Library API access is restricted to app-created items; existing photos require the Picker API.

## Configuration

### Google Cloud setup

1. Create or select a Google Cloud project and enable both the Google Photos Library API and the Google Photos Picker API.
2. Configure the Google Auth Platform consent screen and audience. If the application is in testing, add the Google account that will sign in as a test user. Google may require verification before broader use of sensitive scopes.
3. Create an OAuth client of type **Web application**. Add `https://photos-mcp.kernelkicks.dev/auth/callback` as an authorized redirect URI, using the exact public origin configured for this server. Save the client ID and secret in a private deployment configuration; do not commit or share the secret.
4. The current server requests `openid` and all four Photos scopes needed by its existing tools: `https://www.googleapis.com/auth/photoslibrary.appendonly`, `https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata`, `https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata`, and `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`. The request is not currently configurable per tool. Review these permissions on the consent screen before approving them.

Google limits Library API access to app-created items. The Picker API is the mechanism for selecting other items. See [Google's Photos API updates](https://developers.google.com/photos/support/updates) and [authorization scope documentation](https://developers.google.com/photos/overview/authorization). A real sign-in also requires the configured callback to reach the server over HTTPS; creating the Google client alone does not deploy it.

### Server secrets

Generate an RSA signing key once in a protected directory and persist it across restarts. For example, in a secure shell with Node.js installed:

```sh
umask 077
mkdir -p secrets
node -e 'const c=require("crypto"),f=require("fs"); const {privateKey}=c.generateKeyPairSync("rsa",{modulusLength:2048}); f.writeFileSync("secrets/oidc-jwks.json",JSON.stringify({keys:[{...privateKey.export({format:"jwk"}),kid:c.randomUUID(),use:"sig",alg:"RS256"}]}),{mode:0o600,flag:"wx"})'
```

Configure the following in an uncommitted `.env` file or another deployment secret mechanism:

```dotenv
GOOGLE_CLIENT_ID=replace-me
GOOGLE_CLIENT_SECRET=replace-me
MCP_COOKIE_KEY=replace-with-at-least-32-random-bytes
MCP_JWKS_FILE=./secrets/oidc-jwks.json
MCP_TRUSTED_PROXIES=replace-with-reverse-proxy-address-or-narrow-cidr
MCP_ALLOWED_ORIGINS=
```

The JWKS file must be readable by the container's non-root user. Protect its host permissions and backups. The Compose file supplies the production URL, callback, database paths and host allowlist. Persist and protect both the `photos_data` volume and signing key; loss of the volume or changing the cookie/signing keys invalidates sessions or grants. Google credentials in the database are stored unencrypted, so use encrypted storage and restrict host and backup access.

Set `MCP_TRUSTED_PROXIES` to the actual proxy address or narrowly scoped network as observed by the container. Do not trust the whole internet. The HTTPS reverse proxy must preserve the public `Host` and set `X-Forwarded-Proto: https` itself, replacing any inbound client-supplied forwarding headers. Publish the container only on loopback or a private network, and restrict who can reach that network. The example binds port 3000 to host loopback; proxy/container networking must be configured so the specified proxy address matches the peer seen by Express.

For example, point the public DNS record to a host running Caddy 2.10 or later with ports 80 and 443 available for certificate issuance and HTTPS. The `request_body` directive used here requires Caddy 2.10 or later. A host-installed Caddy can use the following configuration; replace the port if `MCP_BIND_PORT` changes:

```caddyfile
photos-mcp.kernelkicks.dev {
    request_body {
        max_size 1MB
    }
    reverse_proxy 127.0.0.1:3000 {
        header_up Host {host}
        header_up X-Forwarded-Host {host}
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-For {remote_host}
        transport http {
            dial_timeout 5s
            response_header_timeout 60s
        }
    }
}
```

Configure the trusted proxy address as seen **inside** the container; it may differ from the host's loopback address because Docker performs network translation. Verify it against your own networking setup before exposing the proxy. Caddy obtains and renews TLS certificates when DNS and ports are configured correctly. Do not put credentials or query strings in proxy access logs.

After completing the outstanding verification, build and start with `docker compose up -d --build`. Check `/health`, `/.well-known/openid-configuration`, `/.well-known/oauth-protected-resource/mcp`, and that unauthenticated GET, POST and DELETE requests to `/mcp` return 401 with a bearer challenge. Test registration, PKCE, consent, token refresh and revocation using a real client. Back up the volume and secrets before upgrades; rotate compromised Google credentials, cookie keys and signing keys deliberately.

Local STDIO remains available with `npm run stdio`. The legacy unauthenticated HTTP mode binds to `127.0.0.1` only and is intended for local use.

## Clients and troubleshooting

For an MCP client that supports OAuth dynamic registration, use `https://photos-mcp.kernelkicks.dev/mcp` as the server URL and follow its authorization prompt. In ChatGPT, add the URL through its custom connector settings; in Claude or Cursor, use the relevant remote MCP server configuration. Exact setup screens and availability vary by client and plan, and compatibility has not yet been verified with these clients. If a client does not support DCR, this implementation does not yet offer a manual registration workflow.

A 403 usually means the Host or Origin does not match the allowlists. A 400 HTTPS error usually means the proxy address is not trusted or `X-Forwarded-Proto` is absent. A 401 from `/mcp` without a token is expected. For Google redirect errors, check that the exact callback URL and Google OAuth client match. For startup failures, check the data directory is owned by the container user and mode 0700 and that the JWKS secret is readable. Do not publish logs containing authorization codes, tokens or other secrets.

For backups, stop the service cleanly and copy the entire persistent volume and the signing-key file to encrypted, access-controlled storage; restore both together with the same configuration and cookie key. Test restoration separately. Rotating the Google client secret requires updating the Google Cloud client and restarting the service; rotating the cookie key ends sessions, and rotating signing keys or deleting stored grants may require users to reconnect. Revoke compromised Google grants through the Google account's third-party access settings as well as rotating server credentials.
