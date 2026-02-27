#!/bin/bash
set -e

echo "=== Backend Integration Tests ==="
docker compose exec backend pytest tests/integration -v

echo ""
echo "=== Backend Unit Tests ==="
docker compose exec backend pytest tests/unit -v

echo ""
echo "=== BACKEND TESTS PASSED ==="
