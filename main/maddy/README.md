# Maddy SMTP Proxy

This stack runs a small authenticated SMTP submission proxy on the primary
server. Avoin services can use it as their SMTP provider instead of connecting
directly to AWS SES.

## Shape

- Public host: `smtp.example.org`
- Submission ports: `587` with STARTTLS and `465` with implicit TLS
- Client auth: one local maddy user configured in `.env`
- Upstream relay: AWS SES SMTP, configured in `.env`
- TLS: Traefik obtains the Let's Encrypt certificate through `main/proxy`; this
  stack uses `traefik-certs-dumper` to export the certificate from
  `main/proxy/letsencrypt/acme.json`.

## Deploy

1. In `main/proxy/.env`, set:
   - `SMTP_DOMAIN=smtp.example.org`
   - `MAIL_DOMAIN=mail.example.org`
2. Restart the primary proxy so Traefik requests/renews the SMTP host
   certificate:

   ```sh
   cd /home/avoin/avoin-server-infra/main/proxy
   docker compose up -d
   ```

3. Create `main/maddy/.env` from `.env.template` and fill in the local SMTP
   user/password plus SES upstream credentials.
4. Start maddy:

   ```sh
   cd /home/avoin/avoin-server-infra/main/maddy
   docker compose up -d
   ```

## Client Settings

- SMTP host: `smtp.example.org`
- Port: `587`
- Security: STARTTLS
- Username: value of `MADDY_SMTP_USER`
- Password: value of `MADDY_SMTP_PASSWORD`

Port `465` with implicit TLS is also exposed for clients that need it.
