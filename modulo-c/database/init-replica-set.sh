#!/bin/sh
set -eu

echo "Esperando a mongo-1..."
until mongosh --quiet --host mongo-1:27017 --eval "quit(db.adminCommand('ping').ok ? 0 : 2)"; do
  sleep 2
done

mongosh --quiet --host mongo-1:27017 /scripts/init/00-init-replica-set.js

