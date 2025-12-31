#!/usr/bin/env bash
set -euo pipefail

if [ -z "${TOKEN:-}" ]; then
  echo "ERROR: TOKEN is required"
  exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
DOC_DIR="/home/jacob/sharktoothai/ops/synthetic-data/ro_documents"

npm run synthetic:validate

if [ ! -d "$DOC_DIR" ]; then
  echo "ERROR: Document directory not found: $DOC_DIR"
  exit 1
fi

shopt -s nullglob
files=("$DOC_DIR"/*.txt)
shopt -u nullglob

if [ ${#files[@]} -eq 0 ]; then
  echo "Total files found: 0"
  echo "Total successfully ingested: 0"
  echo "Total failed: 0"
  exit 0
fi

total=${#files[@]}
success=0
failed=0

for file in "${files[@]}"; do
  filename=$(basename "$file")
  ro_number="${filename%.txt}"
  content_base64=$(base64 -w 0 "$file")
  payload=$(printf '{"filename":"%s","content_base64":"%s","ro_number":"%s"}' "$filename" "$content_base64" "$ro_number")

  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/workloads/ro/ingest" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload")

  body=$(printf "%s" "$response" | sed '$d')
  status=$(printf "%s" "$response" | tail -n 1)

  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo "$ro_number $status SUCCESS"
    success=$((success + 1))
  else
    echo "$ro_number $status FAIL"
    echo "$body"
    failed=$((failed + 1))
    break
  fi

done

echo "Total files found: $total"
echo "Total successfully ingested: $success"
echo "Total failed: $failed"

if [ "$failed" -ne 0 ]; then
  exit 1
fi
