#!/bin/bash
set -e

echo "=== E2E Tests ==="
# docker compose run --rm e2e npx playwright test
echo "Skipping — E2E tests will be added in Phase 5"

echo ""
echo "=== Backend Integration Tests ==="
docker compose exec backend pytest tests/integration -v

echo ""
echo "=== Backend Unit Tests ==="
docker compose exec backend pytest tests/unit -v

echo ""
echo "=== Frontend Unit Tests ==="
docker compose exec frontend npm test

echo ""
echo "=== ALL TESTS PASSED ==="
