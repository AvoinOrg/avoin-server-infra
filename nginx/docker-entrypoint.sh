#!/usr/bin/env sh
set -eu

envsubst '${DATA_URL}' < /etc/nginx/conf.d/server.avoin.org.conf > /etc/nginx/conf.d/server.avoin.org.conf

exec "$@"