#!/usr/bin/env bash
# Everything CI runs, in the order it runs it. One command before a push.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "--- typecheck"
npx tsc --noEmit

echo "--- build"
npm run build

echo "--- lint"
npx eslint . --max-warnings 0

echo "--- format"
npx prettier --check .

echo "--- tests"
npm test -- --reporter=dot

echo "--- pins"
node scripts/check-pins.mjs

echo "--- dead exports"
node scripts/check-exports.mjs

echo "--- release checks"
node scripts/check-release.mjs

echo "--- the command reference"
node scripts/generate-docs.mjs --check

echo "--- the built cli answers"
node dist/src/cli/main.js --version >/dev/null
node dist/src/cli/main.js store migrations >/dev/null

echo "--- the hot reads still seek"
plans_store="$(mktemp -d)/plans.covercount.db"
node dist/src/cli/main.js --store "$plans_store" store init >/dev/null
node dist/src/cli/main.js --store "$plans_store" store plans


echo "all green"
