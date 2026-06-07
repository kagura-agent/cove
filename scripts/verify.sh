#!/usr/bin/env bash
# Local CI mirror — run before every push.
# Must match .github/workflows/ci.yml exactly.
set -euo pipefail

echo "=== 1/4 Build ==="
pnpm -r build

echo "=== 2/4 Type check ==="
pnpm -r exec tsc --noEmit

echo "=== 3/4 Test ==="
pnpm -r --filter @cove/server exec vitest run

echo "=== 4/4 Bundle check ==="
npx esbuild packages/server/dist/index.js \
  --bundle --platform=node --format=esm \
  --outfile=/dev/null \
  --external:better-sqlite3 --external:ws \
  --alias:@cove/shared=./packages/shared/src/index.ts

echo "✅ All checks passed"
