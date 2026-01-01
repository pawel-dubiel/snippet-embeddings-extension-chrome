chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    title: "Save as Snippet",
    contexts: ["selection"],
    id: "save-snippet"
  });
  chrome.storage.sync.get(['snippets'], function(result) {
    if (chrome.runtime.lastError) {
      throw new Error(`Failed to read snippets: ${chrome.runtime.lastError.message}`);
    }
    if (result.snippets === undefined) {
      chrome.storage.sync.set({snippets: []}, function() {
        if (chrome.runtime.lastError) {
          throw new Error(`Failed to initialize snippets: ${chrome.runtime.lastError.message}`);
        }
      });
      return;
    }
    if (!Array.isArray(result.snippets)) {
      throw new Error('Snippets storage must be an array.');
    }
  });
});

const EMBEDDINGS_KEY = 'snippet_embeddings_v1';

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "save-snippet") {
    return;
  }
  void handleSaveSnippet(info, tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.action === 'embedQuery') {
    void handleEmbedQuery(message, sendResponse);
    return true;
  }
  if (message.action === 'ensureEmbeddings') {
    void handleEnsureEmbeddings(message, sendResponse);
    return true;
  }
});

async function handleSaveSnippet(info, tab) {
  const selectedText = info.selectionText;
  if (typeof selectedText !== 'string' || selectedText.trim().length === 0) {
    throw new Error('Selected text is required to save a snippet.');
  }
  if (!tab || typeof tab.url !== 'string') {
    throw new Error('Tab URL is required to save a snippet.');
  }
  if (typeof tab.id !== 'number') {
    throw new Error('Tab ID is required to save a snippet.');
  }
  const id = generateSnippetId();
  const vector = await embedText(selectedText);
  await saveSnippet({ id, text: selectedText, url: tab.url });
  await saveEmbedding(id, vector);
  sendAnimateMessage(tab.id, selectedText);
}

async function handleEmbedQuery(message, sendResponse) {
  try {
    if (typeof message.text !== 'string' || message.text.trim().length === 0) {
      throw new Error('Query text is required for embedding.');
    }
    const vector = await embedText(message.text);
    sendResponse({ ok: true, vector });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Embedding failed.';
    sendResponse({ ok: false, error: messageText });
  }
}

async function handleEnsureEmbeddings(message, sendResponse) {
  try {
    const items = message.items;
    if (!Array.isArray(items)) {
      throw new Error('Embedding items must be an array.');
    }
    const updated = await ensureEmbeddings(items);
    sendResponse({ ok: true, updated });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Embedding failed.';
    sendResponse({ ok: false, error: messageText });
  }
}

function generateSnippetId() {
  if (!crypto || typeof crypto.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is required to generate snippet IDs.');
  }
  return crypto.randomUUID();
}

async function getStorage(area, keys) {
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

async function setStorage(area, data) {
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

async function saveSnippet({ id, text, url }) {
  const result = await getStorage('sync', ['snippets']);
  if (!Array.isArray(result.snippets)) {
    throw new Error('Snippets storage must be an array.');
  }
  const snippets = result.snippets;
  snippets.push({
    id,
    text,
    url,
    date: new Date().toISOString()
  });
  await setStorage('sync', { snippets });
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

async function saveEmbedding(id, vector) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Embedding ID is required.');
  }
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('Embedding vector is required.');
  }
  const embeddingsIndex = await loadEmbeddingsIndex();
  embeddingsIndex[id] = vector;
  await setStorage('local', { [EMBEDDINGS_KEY]: embeddingsIndex });
}

async function ensureEmbeddings(items) {
  const embeddingsIndex = await loadEmbeddingsIndex();
  let updated = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      throw new Error('Embedding item is invalid.');
    }
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new Error('Embedding item requires an id.');
    }
    if (typeof item.text !== 'string' || item.text.trim().length === 0) {
      throw new Error('Embedding item requires text.');
    }
    if (embeddingsIndex[item.id]) {
      continue;
    }
    const vector = await embedText(item.text);
    embeddingsIndex[item.id] = vector;
    updated += 1;
  }
  if (updated > 0) {
    await setStorage('local', { [EMBEDDINGS_KEY]: embeddingsIndex });
  }
  return updated;
}

async function embedText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text is required for embedding.');
  }
  await ensureOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { target: 'offscreen', action: 'embedText', text },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Embedding failed: ${chrome.runtime.lastError.message}`));
          return;
        }
        if (!response || response.ok !== true || !Array.isArray(response.vector)) {
          const messageText = response && response.error ? response.error : 'Embedding failed.';
          reject(new Error(messageText));
          return;
        }
        resolve(response.vector);
      }
    );
  });
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== 'function') {
    throw new Error('chrome.offscreen is not available.');
  }
  if (!chrome.offscreen.Reason || !chrome.offscreen.Reason.DOM_SCRAPING) {
    throw new Error('chrome.offscreen.Reason.DOM_SCRAPING is not available.');
  }
  if (typeof chrome.offscreen.hasDocument !== 'function') {
    throw new Error('chrome.offscreen.hasDocument is not available.');
  }
  const hasDocument = await chrome.offscreen.hasDocument();
  if (hasDocument) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
    justification: 'Compute local embeddings for saved snippets.'
  });
}

function sendAnimateMessage(tabId, text) {
  chrome.tabs.sendMessage(
    tabId,
    { action: 'animateSnippet', text },
    () => {
      if (chrome.runtime.lastError) {
        console.log('Animation message failed:', chrome.runtime.lastError.message);
      }
    }
  );
}
