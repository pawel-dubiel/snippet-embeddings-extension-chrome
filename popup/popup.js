const EMBEDDINGS_KEY = 'snippet_embeddings_v1';
const STORAGE_LABELS = Object.freeze({
  local: 'Local',
  sync: 'Synced'
});

let snippetsByArea = { local: [], sync: [] };
let activeArea = 'local';
let embeddingsIndex = {};
let searchToken = 0;

document.addEventListener('DOMContentLoaded', () => {
  void initialize();
});

async function initialize() {
  setStatus('', 'idle');
  const clearAllButton = getRequiredElement('clear-all');
  const searchInput = getRequiredElement('search-input');
  const localTab = getRequiredElement('tab-local');
  const syncTab = getRequiredElement('tab-sync');

  clearAllButton.addEventListener('click', () => {
    void clearAllSnippets();
  });
  searchInput.addEventListener('input', () => {
    void filterSnippets();
  });
  localTab.addEventListener('click', () => {
    void setActiveArea('local');
  });
  syncTab.addEventListener('click', () => {
    void setActiveArea('sync');
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

function getBytesInUse(area, keys) {
  if (!chrome.storage || !chrome.storage[area]) {
    throw new Error(`chrome.storage.${area} is not available.`);
  }
  if (typeof chrome.storage[area].getBytesInUse !== 'function') {
    throw new Error(`chrome.storage.${area}.getBytesInUse is not available.`);
  }
  return new Promise((resolve, reject) => {
    chrome.storage[area].getBytesInUse(keys, (bytes) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Storage bytes failed: ${chrome.runtime.lastError.message}`));
        return;
      }
      resolve(bytes);
    });
  });
}

async function loadAndDisplaySnippets() {
  snippetsByArea.local = await loadSnippetsForArea('local');
  snippetsByArea.sync = await loadSnippetsForArea('sync');
  await ensureSnippetIds('local');
  await ensureSnippetIds('sync');

  embeddingsIndex = await loadEmbeddingsIndex();
  const pruned = pruneEmbeddingsIndex();
  if (pruned) {
    await saveEmbeddingsIndex();
  }

  await setActiveArea(activeArea);
}

function getAreaLabel(area) {
  const label = STORAGE_LABELS[area];
  if (!label) {
    throw new Error(`Unsupported storage area: ${area}`);
  }
  return label;
}

function getActiveSnippets() {
  const snippets = snippetsByArea[activeArea];
  if (!Array.isArray(snippets)) {
    throw new Error('Active snippets are invalid.');
  }
  return snippets;
}

function getAllSnippetItems() {
  const items = [];
  for (const area of Object.keys(snippetsByArea)) {
    if (!STORAGE_LABELS[area]) {
      throw new Error(`Unsupported storage area: ${area}`);
    }
    const list = snippetsByArea[area];
    if (!Array.isArray(list)) {
      throw new Error('Snippets storage must be an array.');
    }
    for (const snippet of list) {
      if (!snippet || typeof snippet !== 'object') {
        throw new Error('Snippet entry is invalid.');
      }
      items.push({ snippet, area });
    }
  }
  return items;
}

async function loadSnippetsForArea(area) {
  if (!STORAGE_LABELS[area]) {
    throw new Error(`Unsupported storage area: ${area}`);
  }
  const result = await getStorage(area, ['snippets']);
  if (result.snippets === undefined) {
    throw new Error(`Snippets storage is missing for ${area}.`);
  }
  if (!Array.isArray(result.snippets)) {
    throw new Error('Snippets storage must be an array.');
  }
  return result.snippets;
}

async function saveSnippetsForArea(area, snippets) {
  if (!STORAGE_LABELS[area]) {
    throw new Error(`Unsupported storage area: ${area}`);
  }
  if (!Array.isArray(snippets)) {
    throw new Error('Snippets storage must be an array.');
  }
  await setStorage(area, { snippets });
}

async function ensureSnippetIds(area) {
  if (!STORAGE_LABELS[area]) {
    throw new Error(`Unsupported storage area: ${area}`);
  }
  let updated = false;
  const current = snippetsByArea[area];
  if (!Array.isArray(current)) {
    throw new Error('Snippets storage must be an array.');
  }
  const next = current.map((snippet) => {
    if (!snippet || typeof snippet !== 'object') {
      throw new Error('Snippet entry is invalid.');
    }
    if (!snippet.id) {
      updated = true;
      return { ...snippet, id: generateSnippetId() };
    }
    return snippet;
  });
  snippetsByArea[area] = next;
  if (updated) {
    await saveSnippetsForArea(area, next);
  }
}

function generateSnippetId() {
  if (!crypto || typeof crypto.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is required to generate snippet IDs.');
  }
  return crypto.randomUUID();
}

function updateTabCounts() {
  if (!Array.isArray(snippetsByArea.local) || !Array.isArray(snippetsByArea.sync)) {
    throw new Error('Snippet storage is not initialized.');
  }
  getRequiredElement('tab-count-local').textContent = `${snippetsByArea.local.length}`;
  getRequiredElement('tab-count-sync').textContent = `${snippetsByArea.sync.length}`;
}

function updateTabState() {
  if (!STORAGE_LABELS[activeArea]) {
    throw new Error(`Unsupported storage area: ${activeArea}`);
  }
  const localTab = getRequiredElement('tab-local');
  const syncTab = getRequiredElement('tab-sync');
  const isLocal = activeArea === 'local';
  localTab.classList.toggle('active', isLocal);
  syncTab.classList.toggle('active', !isLocal);
  localTab.setAttribute('aria-selected', isLocal ? 'true' : 'false');
  syncTab.setAttribute('aria-selected', isLocal ? 'false' : 'true');
  localTab.tabIndex = isLocal ? 0 : -1;
  syncTab.tabIndex = isLocal ? -1 : 0;
}

function updateAreaChrome() {
  const label = getAreaLabel(activeArea);
  getRequiredElement('snippets-title').textContent = `${label} snippets`;
  getRequiredElement('storage-label').textContent = `${label} storage`;
  getRequiredElement('clear-all').textContent = `Clear ${label.toLowerCase()}`;
  getRequiredElement('search-input').placeholder = 'Search all snippets...';
}

async function setActiveArea(area) {
  if (!STORAGE_LABELS[area]) {
    throw new Error(`Unsupported storage area: ${area}`);
  }
  activeArea = area;
  searchToken += 1;
  updateTabCounts();
  updateTabState();
  updateAreaChrome();
  try {
    await ensureMissingEmbeddings(area);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Embedding preparation failed.';
    setStatus(message, 'error');
    throw error;
  }
  await updateDisplay();
}

async function updateStorageInfo(area) {
  if (!chrome.storage || !chrome.storage[area]) {
    throw new Error(`chrome.storage.${area} is not available.`);
  }
  if (typeof chrome.storage[area].QUOTA_BYTES !== 'number') {
    throw new Error(`chrome.storage.${area}.QUOTA_BYTES is not available.`);
  }
  const quotaBytes = chrome.storage[area].QUOTA_BYTES;
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
    throw new Error('Storage quota is invalid.');
  }
  const bytesUsed = await getBytesInUse(area, null);
  if (!Number.isFinite(bytesUsed) || bytesUsed < 0) {
    throw new Error('Storage usage is invalid.');
  }
  const usedKBValue = bytesUsed / 1024;
  const limitKBValue = quotaBytes / 1024;
  getRequiredElement('storage-used').textContent = usedKBValue.toFixed(2);
  getRequiredElement('storage-limit').textContent = limitKBValue.toFixed(2);
  const bar = getRequiredElement('storage-bar');
  bar.max = limitKBValue;
  bar.value = Math.min(usedKBValue, limitKBValue);
}

function displaySnippets(items) {
  const list = getRequiredElement('snippets-list');
  list.innerHTML = '';
  if (items.length === 0) {
    const areaLabel = getAreaLabel(activeArea).toLowerCase();
    renderEmptyState(`No ${areaLabel} snippets yet. Save a selection to start building your vault.`);
    return;
  }
  items.forEach((item, displayIndex) => {
    const { snippet, score, area } = item;
    if (!STORAGE_LABELS[area]) {
      throw new Error(`Unsupported storage area: ${area}`);
    }
    const scoreMarkup = Number.isFinite(score)
      ? `<div class="snippet-score">Similarity: ${score.toFixed(3)}</div>`
      : '';
    const areaLabel = getAreaLabel(area);
    const targetArea = area === 'local' ? 'sync' : 'local';
    const moveLabel = area === 'local' ? 'Move to Synced' : 'Move to Local';
    const div = document.createElement('div');
    div.className = 'snippet';
    div.style.setProperty('--delay', `${displayIndex * 45}ms`);
    div.innerHTML = `
      <div class="snippet-meta">
        <span class="snippet-badge snippet-badge--${area}">${areaLabel}</span>
      </div>
      <div class="snippet-text">${snippet.text}</div>
      ${scoreMarkup}
      <div class="snippet-actions">
        <button type="button" id="copy-${displayIndex}" class="btn btn-primary">Copy</button>
        <button type="button" id="move-${displayIndex}" class="btn btn-move">${moveLabel}</button>
        <button type="button" id="delete-${displayIndex}" class="btn btn-danger">Delete</button>
      </div>
    `;
    list.appendChild(div);
    getRequiredElement(`copy-${displayIndex}`).addEventListener('click', () => {
      void copySnippet(area, snippet.id);
    });
    getRequiredElement(`move-${displayIndex}`).addEventListener('click', () => {
      void moveSnippet(area, snippet.id, targetArea);
    });
    getRequiredElement(`delete-${displayIndex}`).addEventListener('click', () => {
      void deleteSnippet(area, snippet.id);
    });
  });
}

function renderEmptyState(message) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('Empty state message is required.');
  }
  const list = getRequiredElement('snippets-list');
  list.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = message;
  list.appendChild(empty);
}

async function filterSnippets() {
  const query = getRequiredElement('search-input').value.trim();
  if (query.length === 0) {
    setStatus('', 'idle');
    const activeSnippets = getActiveSnippets();
    getRequiredElement('snippets-title').textContent = `${getAreaLabel(activeArea)} snippets`;
    displaySnippets(activeSnippets.map((snippet) => ({ snippet, area: activeArea })));
    return;
  }

  const requestId = ++searchToken;
  setStatus('Preparing embeddings...', 'loading');

  try {
    await ensureMissingEmbeddings('local');
    await ensureMissingEmbeddings('sync');
    if (requestId !== searchToken) {
      return;
    }
    setStatus('Searching...', 'loading');
    const ranked = await rankSnippets(query);
    if (requestId !== searchToken) {
      return;
    }
    setStatus('', 'idle');
    getRequiredElement('snippets-title').textContent = 'Search results';
    if (ranked.length === 0) {
      renderEmptyState('No matches in local or synced snippets.');
      return;
    }
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
  const allSnippets = getAllSnippetItems();
  if (allSnippets.length === 0) {
    return [];
  }
  const queryVector = await embedQuery(query);
  const scored = [];

  for (const item of allSnippets) {
    const vector = getSnippetVector(item.snippet);
    const score = getCosineSimilarity(queryVector, vector);
    scored.push({ snippet: item.snippet, area: item.area, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
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
  const ids = new Set();
  for (const area of Object.keys(snippetsByArea)) {
    const list = snippetsByArea[area];
    if (!Array.isArray(list)) {
      throw new Error('Snippets storage must be an array.');
    }
    for (const snippet of list) {
      if (!snippet || typeof snippet !== 'object' || !snippet.id) {
        throw new Error('Snippet entry is invalid.');
      }
      ids.add(snippet.id);
    }
  }
  let changed = false;
  for (const id of Object.keys(embeddingsIndex)) {
    if (!ids.has(id)) {
      delete embeddingsIndex[id];
      changed = true;
    }
  }
  return changed;
}

async function ensureMissingEmbeddings(area) {
  const snippets = snippetsByArea[area];
  if (!Array.isArray(snippets)) {
    throw new Error('Snippets storage must be an array.');
  }
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

function getSnippetIndex(area, id) {
  if (!STORAGE_LABELS[area]) {
    throw new Error(`Unsupported storage area: ${area}`);
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Snippet ID is required.');
  }
  const list = snippetsByArea[area];
  if (!Array.isArray(list)) {
    throw new Error('Snippets storage must be an array.');
  }
  const index = list.findIndex((snippet) => snippet && snippet.id === id);
  if (index === -1) {
    throw new Error('Snippet not found.');
  }
  return index;
}

function copySnippet(area, id) {
  const index = getSnippetIndex(area, id);
  const snippet = snippetsByArea[area][index];
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

async function deleteSnippet(area, id) {
  const index = getSnippetIndex(area, id);
  const list = snippetsByArea[area];
  list.splice(index, 1);
  await saveSnippetsForArea(area, list);
  const pruned = pruneEmbeddingsIndex();
  if (pruned) {
    await saveEmbeddingsIndex();
  }
  await updateDisplay();
}

async function clearAllSnippets() {
  const label = getAreaLabel(activeArea).toLowerCase();
  if (!confirm(`Are you sure you want to delete all ${label} snippets?`)) {
    return;
  }
  snippetsByArea[activeArea] = [];
  await saveSnippetsForArea(activeArea, []);
  const pruned = pruneEmbeddingsIndex();
  if (pruned) {
    await saveEmbeddingsIndex();
  }
  await updateDisplay();
}

async function updateDisplay() {
  updateTabCounts();
  updateTabState();
  updateAreaChrome();
  await updateStorageInfo(activeArea);
  const activeSnippets = getActiveSnippets();
  displaySnippets(activeSnippets.map((snippet) => ({ snippet, area: activeArea })));
  getRequiredElement('search-input').value = '';
  setStatus('', 'idle');
}

async function moveSnippet(area, id, targetArea) {
  if (!STORAGE_LABELS[area]) {
    throw new Error(`Unsupported storage area: ${area}`);
  }
  if (!STORAGE_LABELS[targetArea]) {
    throw new Error(`Unsupported storage area: ${targetArea}`);
  }
  if (targetArea === area) {
    throw new Error('Target storage area must be different.');
  }
  const sourceSnippets = snippetsByArea[area];
  if (!Array.isArray(sourceSnippets)) {
    throw new Error('Source snippets are invalid.');
  }
  const index = getSnippetIndex(area, id);
  const snippet = sourceSnippets[index];
  const destinationSnippets = snippetsByArea[targetArea];
  if (!Array.isArray(destinationSnippets)) {
    throw new Error('Destination snippets are invalid.');
  }
  if (destinationSnippets.some((item) => item && item.id === snippet.id)) {
    throw new Error('Snippet already exists in target storage.');
  }
  sourceSnippets.splice(index, 1);
  destinationSnippets.push(snippet);
  await saveSnippetsForArea(area, sourceSnippets);
  await saveSnippetsForArea(targetArea, destinationSnippets);
  updateTabCounts();
  await updateDisplay();
}
