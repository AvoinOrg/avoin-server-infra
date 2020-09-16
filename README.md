# Avoin Server
Configuration files, scripts, and documentation for Avoin server infrastructure.

## Docker

Run docker-compose.yml with

    docker-compose up --build

Docker-compose uses the following env variables:
    
    # required, the directory for saving nginx logs
    AVOIN_LOGS_PATH

    # required, the root directory for serving files
    AVOIN_DATA_PATH

    # optional, the port used by a running climate-map-backend service
    CLIMATE_MAP_PORT

These can be set in an .env file in the root folder.
