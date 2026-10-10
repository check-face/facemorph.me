#!/bin/sh
# Run against your own started Compose project. Export COMPOSE_FILE for GPU mode.
set -eu
cd "$(dirname "$0")"
docker compose exec -T api python test_runtime_device.py
docker compose exec -T api python test_cpu_threads.py
docker compose exec -T api python test_original_cache.py
docker compose exec -T api python test_adapter_cache.py
docker compose exec -T api python smoke_frontend.py
docker compose exec -T api python test_legacy_contract.py
docker compose exec -T api python test_encoder_assets.py
docker compose exec -T api python test_encoder.py
docker compose exec -T api python smoke_legacy.py
docker compose exec -T api python smoke_encoder_http.py
docker compose exec -T api python smoke_original_cache.py --state /app/checkfacedata/original-smoke.json
if docker compose exec -T api python -c 'from runtime_device import device_status; raise SystemExit(0 if device_status()["provider"] == "cuda" else 1)'; then
    docker compose exec -T api python smoke_gpu.py
fi
docker compose restart api
docker compose up -d --wait --wait-timeout 300 api
docker compose exec -T api python smoke_legacy.py
docker compose exec -T api python smoke_encoder_http.py
docker compose exec -T api python smoke_original_cache.py --state /app/checkfacedata/original-smoke.json --after-restart
