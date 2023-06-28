FROM nginx:latest

ENV CLIMATE_MAP_PORT=${CLIMATE_MAP_PORT}

COPY ./config/ /etc/nginx/

# Add env variables to conf files with the entrypoint
COPY docker-entrypoint.sh /

ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["nginx", "-g", "daemon off;"]

EXPOSE 80 443