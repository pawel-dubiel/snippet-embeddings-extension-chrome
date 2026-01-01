const EMBEDDINGS_KEY = 'snippet_embeddings_v1';

let snippets = [];
let embeddingsIndex = {};
let searchToken = 0;

document.addEventListener('DOMContentLoaded', () => {
  void initialize();
});

async function initialize() {
  setStatus('', 'idle');
  const clearAllButton = getRequiredElement('clear-all');
  const searchInput = getRequiredElement('search-input');

  clearAllButton.addEventListener('click', () => {
    void clearAllSnippets();
  });
  searchInput.addEventListener('input', () => {
    void filterSnippets();
  });

  await loadAndDisplaySnippets();
}

function getRequiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

function setStatus(message, state) {
  const status = getRequiredElement('search-status');
  status.textContent = message;
  status.dataset.state = state;
}

function getStorage(area, keys) {
  if (!chrome.storage || !chrome.storage[area]) {
    throw new Error(`chrome.storage.${area} is not available.`);
  }
  return new Promise((resolve, reject) => {
    chrome.storage[area].get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Storage read failed: ${chrome.runtime.lastError.message}`));
        return;
      }
      resolve(result);
    });
  });
}

function setStorage(area, data) {
  if (!chrome.storage || !chrome.storage[area]) {
    throw new Error(`chrome.storage.${area} is not available.`);
  }
  return new Promise((resolve, reject) => {
    chrome.storage[area].set(data, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Storage write failed: ${chrome.runtime.lastError.message}`));
        return;
      }
      resolve();
    });
  });
}

async function loadAndDisplaySnippets() {
  const result = await getStorage('sync', ['snippets']);
  if (result.snippets === undefined) {
    throw new Error('Snippets storage is missing.');
  }
  if (!Array.isArray(result.snippets)) {
    throw new Error('Snippets storage must be an array.');
  }
  snippets = result.snippets;
  await ensureSnippetIds();

  embeddingsIndex = await loadEmbeddingsIndex();
  const pruned = pruneEmbeddingsIndex();
  if (pruned) {
    await saveEmbeddingsIndex();
  }

  try {
    await ensureMissingEmbeddings();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Embedding preparation failed.';
    setStatus(message, 'error');
    throw error;
  }

  updateStorageInfo();
  displaySnippets(snippets.map((snippet, index) => ({ snippet, index })));
}

async function ensureSnippetIds() {
  let updated = false;
  snippets = snippets.map((snippet) => {
    if (!snippet || typeof snippet !== 'object') {
      throw new Error('Snippet entry is invalid.');
    }
    if (!snippet.id) {
      updated = true;
      return { ...snippet, id: generateSnippetId() };
    }
    return snippet;
  });
  if (updated) {
    await setStorage('sync', { snippets });
  }
}

function generateSnippetId() {
  if (!crypto || typeof crypto.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is required to generate snippet IDs.');
  }
  return crypto.randomUUID();
}

function updateStorageInfo() {
  const size = new Blob([JSON.stringify(snippets)]).size;
  const sizeKB = (size / 1024).toFixed(2);
  getRequiredElement('storage-used').textContent = sizeKB;
  getRequiredElement('storage-bar').value = sizeKB;
}

function displaySnippets(items) {
  const list = getRequiredElement('snippets-list');
  list.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No snippets yet. Save a selection to start building your vault.';
    list.appendChild(empty);
    return;
  }
  items.forEach((item, displayIndex) => {
    const { snippet, index, score } = item;
    const scoreMarkup = Number.isFinite(score)
      ? `<div class="snippet-score">Similarity: ${score.toFixed(3)}</div>`
      : '';
    const div = document.createElement('div');
    div.className = 'snippet';
    div.style.setProperty('--delay', `${displayIndex * 45}ms`);
    div.innerHTML = `
      <div class="snippet-text">${snippet.text}</div>
      ${scoreMarkup}
      <div class="snippet-actions">
        <button type="button" id="copy-${displayIndex}" class="btn btn-primary">Copy</button>
        <button type="button" id="delete-${displayIndex}" class="btn btn-danger">Delete</button>
      </div>
    `;
    list.appendChild(div);
    getRequiredElement(`copy-${displayIndex}`).addEventListener('click', () => copySnippet(index));
    getRequiredElement(`delete-${displayIndex}`).addEventListener('click', () => {
      void deleteSnippet(index);
    });
  });
}

async function filterSnippets() {
  const query = getRequiredElement('search-input').value.trim();
  if (query.length === 0) {
    setStatus('', 'idle');
    displaySnippets(snippets.map((snippet, index) => ({ snippet, index })));
    return;
  }

  const requestId = ++searchToken;
  setStatus('Searching...', 'loading');

  try {
    const ranked = await rankSnippets(query);
    if (requestId !== searchToken) {
      return;
    }
    setStatus('', 'idle');
    displaySnippets(ranked);
  } catch (error) {
    if (requestId !== searchToken) {
      return;
    }
    const message = error instanceof Error ? error.message : 'Search failed.';
    setStatus(message, 'error');
    console.error(error);
    throw error;
  }
}

async function rankSnippets(query) {
  if (snippets.length === 0) {
    return [];
  }
  const queryVector = await embedQuery(query);
  const scored = [];

  for (const [index, snippet] of snippets.entries()) {
    const vector = getSnippetVector(snippet);
    const score = getCosineSimilarity(queryVector, vector);
    scored.push({ snippet, index, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ snippet, index, score }) => ({ snippet, index, score }));
}

function getSnippetVector(snippet) {
  if (!snippet || typeof snippet !== 'object') {
    throw new Error('Snippet is invalid.');
  }
  if (typeof snippet.text !== 'string' || snippet.text.trim().length === 0) {
    throw new Error('Snippet text is required for embeddings.');
  }
  if (!snippet.id) {
    throw new Error('Snippet ID is required for embeddings.');
  }
  const cached = embeddingsIndex[snippet.id];
  if (!cached) {
    throw new Error(`Missing embedding for snippet ${snippet.id}.`);
  }
  return toVector(cached);
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

async function loadEmbeddingsIndex() {
  const result = await getStorage('local', [EMBEDDINGS_KEY]);
  const stored = result[EMBEDDINGS_KEY];
  if (stored === undefined) {
    return {};
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('Embeddings storage must be an object.');
  }
  return stored;
}

async function saveEmbeddingsIndex() {
  await setStorage('local', { [EMBEDDINGS_KEY]: embeddingsIndex });
}

function pruneEmbeddingsIndex() {
  const ids = new Set(snippets.map((snippet) => snippet.id));
  let changed = false;
  for (const id of Object.keys(embeddingsIndex)) {
    if (!ids.has(id)) {
      delete embeddingsIndex[id];
      changed = true;
    }
  }
  return changed;
}

async function ensureMissingEmbeddings() {
  if (snippets.length === 0) {
    return;
  }
  const missing = [];
  for (const snippet of snippets) {
    if (!snippet || typeof snippet !== 'object') {
      throw new Error('Snippet entry is invalid.');
    }
    if (!snippet.id) {
      throw new Error('Snippet ID is required for embeddings.');
    }
    if (typeof snippet.text !== 'string' || snippet.text.trim().length === 0) {
      throw new Error('Snippet text is required for embeddings.');
    }
    if (!embeddingsIndex[snippet.id]) {
      missing.push({ id: snippet.id, text: snippet.text });
    }
  }
  if (missing.length === 0) {
    return;
  }
  setStatus('Preparing embeddings...', 'loading');
  const response = await sendRuntimeMessage({ action: 'ensureEmbeddings', items: missing });
  if (!response || response.ok !== true) {
    const message = response && response.error ? response.error : 'Embedding preparation failed.';
    throw new Error(message);
  }
  embeddingsIndex = await loadEmbeddingsIndex();
  const stillMissing = missing.filter((item) => !embeddingsIndex[item.id]);
  if (stillMissing.length > 0) {
    throw new Error(`Missing embeddings for ${stillMissing.length} snippet(s).`);
  }
  setStatus('', 'idle');
}

async function embedQuery(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Query text is required.');
  }
  const response = await sendRuntimeMessage({ action: 'embedQuery', text });
  if (!response || response.ok !== true || !Array.isArray(response.vector)) {
    const message = response && response.error ? response.error : 'Query embedding failed.';
    throw new Error(message);
  }
  return Float32Array.from(response.vector);
}

function sendRuntimeMessage(payload) {
  if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
    throw new Error('chrome.runtime.sendMessage is not available.');
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Runtime message failed: ${chrome.runtime.lastError.message}`));
        return;
      }
      resolve(response);
    });
  });
}

function getCosineSimilarity(a, b) {
  if (!a || !b || typeof a.length !== 'number' || typeof b.length !== 'number') {
    throw new Error('Cosine similarity requires vectors.');
  }
  if (a.length !== b.length) {
    throw new Error('Cosine similarity requires vectors of equal length.');
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (!Number.isFinite(ai) || !Number.isFinite(bi)) {
      throw new Error('Cosine similarity requires finite vector values.');
    }
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) {
    throw new Error('Cosine similarity requires non-zero vectors.');
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function copySnippet(index) {
  const snippet = snippets[index];
  if (!snippet || typeof snippet.text !== 'string') {
    throw new Error('Snippet text is missing.');
  }
  const textArea = document.createElement('textarea');
  textArea.value = snippet.text;
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
  alert('Snippet copied!');
}

async function deleteSnippet(index) {
  const snippet = snippets[index];
  if (!snippet) {
    throw new Error('Snippet not found.');
  }
  snippets.splice(index, 1);
  await setStorage('sync', { snippets });
  if (snippet.id && embeddingsIndex[snippet.id]) {
    delete embeddingsIndex[snippet.id];
    await saveEmbeddingsIndex();
  }
  updateDisplay();
}

async function clearAllSnippets() {
  if (confirm('Are you sure you want to delete all snippets?')) {
    snippets = [];
    embeddingsIndex = {};
    await setStorage('sync', { snippets });
    await saveEmbeddingsIndex();
    updateDisplay();
  }
}

function updateDisplay() {
  updateStorageInfo();
  displaySnippets(snippets.map((snippet, idx) => ({ snippet, index: idx })));
  getRequiredElement('search-input').value = '';
  setStatus('', 'idle');
}
