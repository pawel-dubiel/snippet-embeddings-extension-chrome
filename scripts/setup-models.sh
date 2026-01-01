#!/usr/bin/env bash
set -euo pipefail

MODEL_ID="Xenova/paraphrase-multilingual-MiniLM-L12-v2"
BASE_URL="https://huggingface.co/${MODEL_ID}/resolve/main"
DEST_DIR="models/${MODEL_ID}"
FILES=(
  "config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "special_tokens_map.json"
  "unigram.json"
  "onnx/model.onnx"
)

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required to download model assets." >&2
  exit 1
fi

mkdir -p "${DEST_DIR}/onnx"

for file in "${FILES[@]}"; do
  url="${BASE_URL}/${file}"
  dest="${DEST_DIR}/${file}"
  if [[ -s "${dest}" ]]; then
    echo "Already present: ${dest}"
    continue
  fi
  echo "Downloading ${url}"
  curl -fL --retry 3 --retry-delay 1 -o "${dest}" "${url}"
done
