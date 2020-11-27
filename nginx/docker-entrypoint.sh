#!/usr/bin/env sh
set -eu

envsubst '${DATA_URL}' < /etc/nginx/conf.d/server.avoin.org.conf.template > /etc/nginx/conf.d/server.avoin.org.conf
rm /etc/nginx/conf.d/server.avoin.org.conf.template

exec "$@"