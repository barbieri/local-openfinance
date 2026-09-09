#!/usr/bin/env sh
set -eu

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
OLLAMA_EMBEDDINGS_MODEL="${OLLAMA_EMBEDDINGS_MODEL:-nomic-embed-text}"
OLLAMA_LOG_PATH="${OLLAMA_LOG_PATH:-tmp/ollama.log}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama command not found. Install Ollama first: https://ollama.com/download" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl command not found; curl is required for the smoke check." >&2
  exit 1
fi

if ! curl -fsS "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
  mkdir -p "$(dirname "${OLLAMA_LOG_PATH}")"
  echo "Starting Ollama on ${OLLAMA_HOST}; logs: ${OLLAMA_LOG_PATH}"
  OLLAMA_HOST="${OLLAMA_HOST}" ollama serve >"${OLLAMA_LOG_PATH}" 2>&1 &

  attempt=0
  while ! curl -fsS "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "${attempt}" -ge 30 ]; then
      echo "Ollama did not become ready at ${OLLAMA_URL}; see ${OLLAMA_LOG_PATH}" >&2
      exit 1
    fi
    sleep 1
  done
fi

echo "Pulling embeddings model ${OLLAMA_EMBEDDINGS_MODEL}"
ollama pull "${OLLAMA_EMBEDDINGS_MODEL}"

payload="$(
  node -e 'console.log(JSON.stringify({
    model: process.argv[1],
    input: "Open Finance transaction: Uber airport ride, transport category, BRL 42.50"
  }))' "${OLLAMA_EMBEDDINGS_MODEL}"
)"

echo "Running embeddings smoke request against ${OLLAMA_URL}/api/embed"
curl -fsS \
  -H "Content-Type: application/json" \
  -d "${payload}" \
  "${OLLAMA_URL}/api/embed" >/dev/null

echo "Ollama embeddings are ready: ${OLLAMA_EMBEDDINGS_MODEL} at ${OLLAMA_URL}"
