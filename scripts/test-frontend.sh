#!/bin/bash
set -e

echo "=== Frontend Unit Tests ==="
docker compose exec frontend npm test

echo ""
echo "=== FRONTEND TESTS PASSED ==="
