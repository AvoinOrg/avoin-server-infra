# Kan

Kan is the AGPLv3 self-hosted Trello alternative exposed at
`https://kan.avoin.org`.

## Dokploy

- Project/environment: `avoin` / `production`
- Compose path: `./secondary/kan/docker-compose.yml`
- Domain: `kan.avoin.org`
- Service: `web`
- Port: `3000`
- Certificate: Let's Encrypt via Dokploy

Use `secondary/kan/.env.template` as the tracked shape for Dokploy environment
values. Real values live in Dokploy and must not be committed.

## Email

Live Dokploy values use the Avoin SES SMTP submission proxy:

- Host: `smtp.avoin.org`
- Port: `587`
- Security: STARTTLS/TLS (`SMTP_SECURE=false`)
- Sender: `Kan <kan@avoin.org>`
- Username/password: the SMTP proxy client credentials

## Zitadel OIDC

Kan supports generic OIDC through environment variables. Create a Zitadel web
application for `https://kan.avoin.org` with this redirect URI:

```text
https://kan.avoin.org/api/auth/oauth2/callback/oidc
```

Then set these Dokploy variables:

- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_DISCOVERY_URL=https://auth.avoin.org/.well-known/openid-configuration`
- `BETTER_AUTH_TRUSTED_ORIGINS=https://kan.avoin.org`

Keep `openid profile email` enabled in Zitadel and ensure the userinfo response
contains the user's email.

Password credentials and public signup are disabled by default
(`NEXT_PUBLIC_ALLOW_CREDENTIALS=false`, `NEXT_PUBLIC_DISABLE_SIGN_UP=true`).
New users must be invited from an existing Kan workspace; invite signups are
still allowed by Kan's auth hook.

## API And Agents

Kan exposes REST API endpoints and ships an MCP server. Create an API key in Kan
user settings, then run the MCP server with:

```sh
KAN_BASE_URL=https://kan.avoin.org KAN_API_TOKEN=<api-key> npx -y @kan/mcp
```

## Storage

S3/MinIO file storage is optional. It is intentionally omitted from the compose
environment until a public storage domain is chosen. Do not pass blank
`NEXT_PUBLIC_STORAGE_URL`; Kan validates it as a URL when present. Without S3,
the Kan health endpoint reports storage as `not_configured`.
