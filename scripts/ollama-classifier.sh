#!/usr/bin/env sh
set -eu

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
OLLAMA_CLASSIFIER_MODEL="${OLLAMA_CLASSIFIER_MODEL:-qwen3:0.6b}"
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

echo "Pulling classifier model ${OLLAMA_CLASSIFIER_MODEL}"
ollama pull "${OLLAMA_CLASSIFIER_MODEL}"

payload="$(
  node -e 'console.log(JSON.stringify({
    model: process.argv[1],
    prompt: "Classify this Open Finance expense as exactly one slug: food.groceries, transport.ride_hailing, housing.rent, or unknown. Description: Uber trip to airport.",
    stream: false,
    options: { temperature: 0 }
  }))' "${OLLAMA_CLASSIFIER_MODEL}"
)"

echo "Running classifier smoke request against ${OLLAMA_URL}/api/generate"
curl -fsS \
  -H "Content-Type: application/json" \
  -d "${payload}" \
  "${OLLAMA_URL}/api/generate" >/dev/null

echo "Ollama classifier is ready: ${OLLAMA_CLASSIFIER_MODEL} at ${OLLAMA_URL}"
