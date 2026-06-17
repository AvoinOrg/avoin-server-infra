#!/bin/sh
set -eu

require_env() {
  var_name="$1"
  eval "value=\${$var_name:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $var_name" >&2
    exit 1
  fi
}

require_env MADDY_TLS_DOMAIN
require_env MADDY_SMTP_USER
require_env MADDY_SMTP_PASSWORD
require_env MADDY_SES_HOST
require_env MADDY_SES_PORT
require_env MADDY_SES_USERNAME
require_env MADDY_SES_PASSWORD

mkdir -p /data/auth
hash="$(maddy hash --hash argon2 --password "$MADDY_SMTP_PASSWORD" 2>/dev/null)"
if [ -z "$hash" ]; then
  echo "Failed to generate maddy SMTP password hash" >&2
  exit 1
fi
printf '%s: %s\n' "$MADDY_SMTP_USER" "$hash" > /data/auth/smtp_passwd
chmod 600 /data/auth/smtp_passwd
unset MADDY_SMTP_PASSWORD

cert_path="/certs/${MADDY_TLS_DOMAIN}/certificate.pem"
key_path="/certs/${MADDY_TLS_DOMAIN}/privatekey.pem"
wait_seconds="${MADDY_TLS_WAIT_SECONDS:-180}"

i=0
while [ "$i" -lt "$wait_seconds" ]; do
  if [ -s "$cert_path" ] && [ -s "$key_path" ]; then
    break
  fi
  i=$((i + 1))
  echo "Waiting for TLS certificate files for ${MADDY_TLS_DOMAIN} (${i}/${wait_seconds})" >&2
  sleep 1
done

if [ ! -s "$cert_path" ] || [ ! -s "$key_path" ]; then
  echo "TLS certificate files were not found for ${MADDY_TLS_DOMAIN}" >&2
  exit 1
fi

exec maddy --config /etc/maddy/maddy.conf run
