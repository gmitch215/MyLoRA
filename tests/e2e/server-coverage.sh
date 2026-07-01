#!/usr/bin/env sh
set -e

if [ ! -d .coverage/server-raw ]; then
	echo "[coverage:server] no .coverage/server-raw dumps; skipping"
	exit 0
fi

# c8 only maps sourcemaps when --src is absolute and breaks under --include/--all, so run it bare
# and filter to repo-relative src/server afterwards (see filter-server-lcov.mjs)
bunx c8 report \
	--temp-directory .coverage/server-raw \
	--reporter lcovonly \
	--report-dir coverage/server \
	--src "$PWD/src" \
	--exclude '**/*.d.ts'

node tests/e2e/filter-server-lcov.mjs coverage/server/lcov.info "$PWD"
