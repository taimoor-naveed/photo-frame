#!/bin/bash
set -e

echo "=== Frontend Unit Tests ==="
docker compose exec frontend npm test

echo ""
echo "=== Backend Unit Tests ==="
docker compose exec backend pytest tests/unit -v

echo ""
echo "=== Backend Integration Tests ==="
docker compose exec backend pytest tests/integration -v

echo ""
echo "=== E2E Tests ==="
docker compose --profile test run --rm e2e npx playwright test

echo ""
echo "=== ALL TESTS PASSED ==="
