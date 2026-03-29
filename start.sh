#!/bin/sh
# Load .env to read USE_LOCAL_OLLAMA
set -a; . ./.env; set +a

if [ "${USE_LOCAL_OLLAMA}" = "true" ]; then
    echo "[*] Starting with local Ollama..."
    docker compose --profile ollama up "$@"
else
    echo "[*] Starting with external LLM (${OPENAI_API_BASE})..."
    docker compose up "$@"
fi
