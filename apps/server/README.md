# Pi Station server

This is the only Pi Station application server. It uses the public Pi SDK and serves the Workspace plus the stable normalized `/v2/**` HTTP contract.

Use `npm run dev:server`, or `npm run dev:isolated` for a separate port and data directory. Production uses `PI_STATION_PORT`, `PI_STATION_DATA_DIR`, `PI_STATION_SHARED_ROOT`, `PI_STATION_WEB_ROOT`, `PI_STATION_WEB_ORIGIN`, and `PI_STATION_LOCAL_ORIGIN`.

See the repository README for the one-boundary data-name migration and rollback rules.
