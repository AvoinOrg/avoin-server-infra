#!/bin/bash

# Load environment variables from .env
if [ -f .env ]; then
    source .env
else
    echo "Error: .env file not found"
    exit 1
fi

# Check if LOKI_STORAGE_PATH is set
if [ -z "${LOKI_STORAGE_PATH}" ]; then
    echo "Error: LOKI_STORAGE_PATH is not set in .env"
    exit 1
fi

# Create storage directory if it doesn't exist
mkdir -p ${LOKI_STORAGE_PATH}

# Set permissions (10001 is Loki's default user)
sudo chown -R 10001:10001 ${LOKI_STORAGE_PATH}
sudo chmod -R 755 ${LOKI_STORAGE_PATH}

# Check if GRAFANA_STORAGE_PATH is set
if [ -z "${GRAFANA_STORAGE_PATH}" ]; then
    echo "Error: GRAFANA_STORAGE_PATH is not set in .env"
    exit 1
fi

# Create storage directory if it doesn't exist
mkdir -p ${GRAFANA_STORAGE_PATH}

# Set permissions (472 is Grafana's default user)
sudo chown -R 472:472 ${GRAFANA_STORAGE_PATH}
sudo chmod -R 755 ${GRAFANA_STORAGE_PATH}