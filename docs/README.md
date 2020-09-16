# Misc

Initializing docker service:

    mkdir -p /etc/systemd/system/docker.service.d

    nano /etc/systemd/system/docker.service.d/http-proxy.conf 

[Service]
Environment="http://IP:PORT/"

    nano /etc/systemd/system/docker.service.d/https-proxy.conf 

[Service]
Environment="http://IP:PORT/"

    systemctl daemon-reload
    systemctl restart docker


Bi-daily cronjob for cert renewal
    0 */12 * * * certbot renew --post-hook "docker-compose -f /home/avoin/avoin-server/prod/docker-compose.yml restart"