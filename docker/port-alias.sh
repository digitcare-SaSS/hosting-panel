#!/bin/bash
# docker-compose publishes hosted apps as host 8080/8443 -> container 80/443.
# Mirror those ports inside the container so URLs like
# http://app.localhost:8080 also work when the panel calls them itself.
socat TCP-LISTEN:8080,bind=127.0.0.1,fork,reuseaddr TCP:127.0.0.1:80 &
socat TCP-LISTEN:8443,bind=127.0.0.1,fork,reuseaddr TCP:127.0.0.1:443 &
wait -n
