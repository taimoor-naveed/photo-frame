#!/bin/bash
set -e

echo "=== E2E Tests ==="
docker compose --profile test run --rm e2e npx playwright test
