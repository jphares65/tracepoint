#!/bin/sh
exec /usr/lib/postgresql/16/bin/psql -h 127.0.0.1 -p 55493 -U postgres -d tpverify -X "$@"
