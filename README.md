# Snippet Manager (Local Embeddings)

Browser extension that saves selected text snippets and lets you search them using on-device semantic embeddings. The model is downloaded locally after cloning (not stored in Git), so no API token is required and nothing is sent to external services.

## Experimental
This extension is experimental because it runs a local embedding model inside the browser. It uses the ONNX version of `Xenova/paraphrase-multilingual-MiniLM-L12-v2` through Transformers.js + ONNX Runtime Web (WASM). Loading the model can consume significant memory: expect roughly ~450–650 MB steady-state with peaks that can approach ~1 GB during first load or initial inference. This can vary by browser version, device RAM, and allocator behavior.

## Features
- Save selected text from any page using the context menu.
- Add snippets manually from the popup.
- View, copy, delete, and move snippets between local and synced storage in the popup.
- Semantic search with cosine similarity ranking.
- Local embeddings model bundled with the extension (no network calls at runtime).

## How It Works
- **Background**: stores snippets in `chrome.storage.local` (default) and triggers the flying animation.
- **Popup**: loads snippets, requests embeddings via the background, and reorders results by similarity.
- **Offscreen**: loads the local model and produces embeddings on demand.
- **Embeddings**: `@huggingface/transformers` (Transformers.js) runs ONNX locally via `onnxruntime-web`.

## Model Assets (download after clone)
Model files are intentionally excluded from Git to avoid large repo size. Run the setup script once after cloning.

```bash
./scripts/setup-models.sh
```

Requirements: `curl` must be available in your shell.

This script downloads the following files into `models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/`:
- `https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/config.json`
- `https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json`
- `https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer_config.json`
- `https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/special_tokens_map.json`
- `https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/unigram.json`
- `https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model.onnx`

Notes:
- Format: ONNX (`onnx/model.onnx`) + tokenizer files.
- If assets are missing, embedding requests fail fast with an explicit error.

## Local Runtime Dependencies
Bundled into the extension so it works offline:
- `vendor/transformers.js` (Transformers.js)
- `vendor/ort.bundle.min.mjs` and `vendor/ort-wasm-simd-threaded.jsep.*` (ONNX Runtime Web)

## Data Storage
- Snippets (local tab): `chrome.storage.local`
- Snippets (synced tab): `chrome.storage.sync` (quota-limited)
- Embeddings cache: `chrome.storage.local`

## Load the Extension
1. Open `chrome://extensions`
2. Enable Developer mode.
3. Click "Load unpacked" and select this project directory.

## Licenses and Compliance
This project bundles third-party components that must remain license-compliant:
- **Apache-2.0**: Transformers.js and the Xenova model assets.
- **MIT**: ONNX Runtime Web.
