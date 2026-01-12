#!/usr/bin/env bash
set -euo pipefail

if [ -z "${TOKEN:-}" ]; then
  echo "ERROR: TOKEN is required (JWT Bearer token)." >&2
  exit 1
fi

if [ -z "${TENANT_ID:-}" ]; then
  echo "ERROR: TENANT_ID is required." >&2
  exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
INGEST_DELAY_SEC="${INGEST_DELAY_SEC:-1}"
RAW_INTAKE_DIR="${RAW_INTAKE_DIR:-/data/raw_intake}"

if ! npm run synthetic:validate; then
  echo "ERROR: synthetic:validate failed; aborting ingest." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
doc_dir="$SCRIPT_DIR/ro_documents"

if [ ! -d "$doc_dir" ]; then
  echo "ERROR: Directory not found: $doc_dir" >&2
  exit 1
fi

xml_files=()
for f in "$doc_dir"/*.xml; do
  if [ -e "$f" ]; then
    xml_files+=("$f")
  fi
  break
done

if [ "${#xml_files[@]}" -eq 0 ]; then
  echo "No XML files found in $doc_dir; nothing to ingest."
  exit 0
fi

# Rebuild full list now that we know there is at least one match.
xml_files=("$doc_dir"/*.xml)

found_count=${#xml_files[@]}
success_count=0
fail_count=0
skip_count=0

for file_path in "${xml_files[@]}"; do
  filename="$(basename "$file_path")"
  uuid="$(node -e "console.log(require('crypto').randomUUID())")"
  date_stamp="$(date +%F)"
  dest_dir="$RAW_INTAKE_DIR/tenant=$TENANT_ID/date=$date_stamp/source=ftp"
  dest_path="$dest_dir/$uuid.xml"

  mkdir -p "$dest_dir"
  cp -n "$file_path" "$dest_path"
  storage_uri="file://$dest_path"

  response_file="$(mktemp)"
  http_status=$(curl -sS -o "$response_file" -w "%{http_code}" \
    -X POST "$BASE_URL/workloads/ro/ingest-from-storage" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"tenant_id\":\"$TENANT_ID\",\"storage_uri\":\"$storage_uri\",\"source\":\"ftp\",\"received_at\":\"$(date -Iseconds)\"}") || {
      echo "ERROR: curl failed for $filename" >&2
      rm -f "$response_file"
      exit 1
    }

  if [ "$http_status" -lt 200 ] || [ "$http_status" -ge 300 ]; then
    if grep -qi "duplicate key value" "$response_file"; then
      echo "Skipping duplicate $filename"
      skip_count=$((skip_count + 1))
      rm -f "$response_file"
      sleep "$INGEST_DELAY_SEC"
      continue
    fi
    echo "Ingest failed for $filename" >&2
    echo "HTTP status: $http_status" >&2
    echo "Response body:" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    fail_count=$((fail_count + 1))
    exit 1
  fi

  rm -f "$response_file"
  success_count=$((success_count + 1))
  echo "Ingesting $filename ... OK"
  
  # Ensure serial processing (no parallelism).
  sleep "$INGEST_DELAY_SEC"
done

echo "Total XML files found: $found_count"
echo "Total successfully ingested: $success_count"
echo "Total skipped (duplicates): $skip_count"
echo "Total failed: $fail_count"
