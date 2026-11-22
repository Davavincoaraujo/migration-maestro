#!/bin/sh
# Run from the repository in the original Maestri shell. Only check is called.
set -u
umask 077
capture_dir=$(mktemp -d "${TMPDIR:-/tmp}/model-router-diagnose.XXXXXX") || exit 1
trap 'rm -rf "$capture_dir"' EXIT HUP INT TERM
agent=${1:-Hermes}
shell_executable=$(command -v maestri) || exit 1
maestri check "$agent" > "$capture_dir/stdout" 2> "$capture_dir/stderr"
shell_status=$?
node --import tsx src/cli-model-router-diagnose.ts "$capture_dir/stdout" "$capture_dir/stderr" "$shell_status" "$shell_executable" "$agent"
