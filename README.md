# Avoin Server
Configuration files, scripts, and documentation for Avoin server infrastructure.

## Docker

Launch the Traefik reverse proxy with

    docker compose up --build

Copy the ".env.template" to ".env", and configure the variables. Docker compose uses the following env variables:
    
    # the directory for saving nginx logs
    AVOIN_LOGS_PATH

    # the cloud file storage url for serving files. Generally, S3 has been used.
    DATA_URL

    # the url for authentication service, e.g. keycloak
    AUTH_URL

    # domain name, for which Traefik automatically used letsencrypt to generate certificates
    DOMAIN

    # admin domain email address for the letsencrypt certs
    DOMAIN_EMAIL


The traefik dashboard is accessible at http://localhost:8090/dashboard/ 
