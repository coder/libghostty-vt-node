#!/usr/bin/env bash
set -u

npm install
npm run build
npm test
npm run build:libghostty
npm run build:native
npm run smoke
npm pack --dry-run
node -e "import('./dist/index.js').then((m)=>console.log(JSON.stringify(m.getNativeInfo(), null, 2))).catch((err)=>{ console.log(JSON.stringify({ ok: false, error: err.message, cause: err.cause ? String(err.cause.message || err.cause) : undefined }, null, 2)); process.exitCode = 0; })"
