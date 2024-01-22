#!/bin/bash

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"

for dir in "$SCRIPT_DIR"/*/
do
    COMPOSE_FILE="$dir/docker-compose.y*"
    
    if [ -f $COMPOSE_FILE ]; then
        echo "Found $COMPOSE_FILE. Running docker compose pull and up..."
        (cd "$dir" && docker compose pull && docker compose up -d)
    fi
done
