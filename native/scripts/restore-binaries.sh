#!/bin/sh
# Materialize binary files that are stored base64-encoded (*.b64) in this repo
# mirror (the push channel was text-only). Safe to re-run.
set -e
cd "$(dirname "$0")/.."
find ios android -name '*.b64' | while read -r f; do
  out="${f%.b64}"
  openssl base64 -d -in "$f" -out "$out"
  echo "restored $out"
done
