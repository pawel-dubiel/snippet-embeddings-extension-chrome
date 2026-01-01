import { pipeline, env } from './vendor/transformers.js';

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const EMBEDDING_OPTIONS = Object.freeze({ pooling: 'mean', normalize: true });
const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'unigram.json',
  'onnx/model.onnx'
];

let embedderPromise = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') {
    return;
  }
  if (message.action === 'embedText') {
    void handleEmbedText(message, sendResponse);
    return true;
  }
});

async function handleEmbedText(message, sendResponse) {
  try {
    if (typeof message.text !== 'string' || message.text.trim().length === 0) {
      throw new Error('Embedding requires non-empty text.');
    }
    const embedder = await getEmbedder();
    const output = await embedder(message.text, EMBEDDING_OPTIONS);
    const vector = toVector(output);
    sendResponse({ ok: true, vector: Array.from(vector) });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Embedding failed.';
    sendResponse({ ok: false, error: messageText });
  }
}

async function getEmbedder() {
  if (embedderPromise) {
    return embedderPromise;
  }

  embedderPromise = (async () => {
    if (!env || typeof env !== 'object') {
      throw new Error('Transformers env is unavailable.');
    }
    if (typeof pipeline !== 'function') {
      throw new Error('Transformers pipeline is unavailable.');
    }
    if (!env.backends || !env.backends.onnx || !env.backends.onnx.wasm) {
      throw new Error('Transformers ONNX backend is unavailable.');
    }

    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = chrome.runtime.getURL('models/');
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/');
    env.backends.onnx.wasm.numThreads = 1;

    await ensureModelAssets();
    return pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32', device: 'wasm' });
  })();

  return embedderPromise;
}

async function ensureModelAssets() {
  const basePath = `models/${MODEL_ID}/`;
  await Promise.all(MODEL_FILES.map(async (file) => {
    const url = chrome.runtime.getURL(`${basePath}${file}`);
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(`Missing local model asset: ${file}`);
    }
  }));
}

function toVector(output) {
  if (output && output.data instanceof Float32Array) {
    return output.data;
  }
  if (output && output.data) {
    return Float32Array.from(output.data);
  }
  if (output instanceof Float32Array) {
    return output;
  }
  if (Array.isArray(output)) {
    return Float32Array.from(output);
  }
  throw new Error('Embedding output is missing vector data.');
}
