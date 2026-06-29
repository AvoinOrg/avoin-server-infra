# Plane

Plane is a self-hosted project management board/tracker exposed at
`https://plane.avoin.org`.

This stack is based on Plane `v1.3.1` release assets. It keeps Plane's internal
`plane-proxy` service for the app/API/live/admin route fanout, then exposes that
proxy through Dokploy's domain routing on `proxy:80`.

## Dokploy

- Project/environment: `avoin` / `production`
- Compose path: `./secondary/plane/docker-compose.yml`
- Domain: `plane.avoin.org`
- Service: `proxy`
- Port: `80`
- Certificate: Let's Encrypt via Dokploy

Use `secondary/plane/.env.template` as the tracked shape for Dokploy
environment values. Real values live in Dokploy and must not be committed.

## First Run

New Plane instances no longer ship the old default `captain@plane.so` account.
After deploy, open `/god-mode` and complete secure instance setup with a real
admin email and a generated password.

## Email

Plane outgoing SMTP is configured through the Compose environment and can later
be adjusted from `/god-mode` after instance setup. Live Dokploy values should use
the Avoin SES SMTP submission proxy:

- Host: `smtp.avoin.org`
- Port: `587`
- Security: STARTTLS/TLS
- Sender: `plane@avoin.org`
- Username/password: the SMTP proxy client credentials

## Zitadel OIDC

Plane's native custom OIDC setup is configured in
`/god-mode/authentication/oidc`. It may require a Plane Pro/Business-capable
instance. Configure a Zitadel web application for:

- Origin URL: `https://plane.avoin.org/auth/oidc/`
- Callback URL: `https://plane.avoin.org/auth/oidc/callback/`
- Logout URL: `https://plane.avoin.org/auth/oidc/logout/`
- Scopes/claims: `openid profile email`, with `email` present in userinfo

Copy the Zitadel client ID, client secret, authorization URL, token URL, and
userinfo URL into Plane's OIDC settings.
