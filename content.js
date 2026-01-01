let animationElement = null;
let lastSelectionPosition = null;

document.addEventListener('contextmenu', () => {
  const selectionPosition = getSelectionPosition();
  if (selectionPosition) {
    lastSelectionPosition = selectionPosition;
  }
});

function getSelectionPosition() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
    return null;
  }
  return {
    x: rect.left,
    y: rect.top,
    text: selectedText
  };
}

function getAnimationTarget() {
  const root = document.documentElement;
  if (!root) {
    throw new Error('Animation requires documentElement for viewport size.');
  }
  const viewportWidth = root.clientWidth;
  const viewportHeight = root.clientHeight;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    throw new Error('Viewport width is invalid for animation.');
  }
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new Error('Viewport height is invalid for animation.');
  }
  if (!Number.isFinite(window.outerHeight) || !Number.isFinite(window.innerHeight)) {
    throw new Error('Window dimensions are invalid for animation.');
  }
  const chromeTop = window.outerHeight - window.innerHeight;
  if (!Number.isFinite(chromeTop)) {
    throw new Error('Browser chrome height is invalid for animation.');
  }

  const endX = viewportWidth - 18;
  const endY = -Math.round(chromeTop * 0.55);

  return { endX, endY };
}

function createAnimationElement(text, startX, startY) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Animation requires non-empty text.');
  }
  if (!Number.isFinite(startX) || !Number.isFinite(startY)) {
    throw new Error('Animation requires valid start coordinates.');
  }
  if (!document.head) {
    throw new Error('Animation requires a document head for styles.');
  }
  if (!document.body) {
    throw new Error('Animation requires a document body for the element.');
  }

  if (animationElement) {
    animationElement.remove();
  }

  animationElement = document.createElement('div');
  animationElement.textContent = text.length > 20 ? text.substring(0, 20) + '...' : text;
  animationElement.style.cssText = `
    position: fixed;
    left: ${startX}px;
    top: ${startY}px;
    background: #4285f4;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-family: Arial, sans-serif;
    z-index: 10000;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    animation: flyToIcon 1s ease-in-out forwards;
  `;

  const { endX, endY } = getAnimationTarget();

  const keyframes = `
    @keyframes flyToIcon {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.1); opacity: 0.8; }
      100% { transform: scale(0.5); opacity: 0; left: ${endX}px; top: ${endY}px; }
    }
  `;

  const style = document.createElement('style');
  style.textContent = keyframes;
  document.head.appendChild(style);

  document.body.appendChild(animationElement);

  setTimeout(() => {
    if (animationElement) {
      animationElement.remove();
      animationElement = null;
    }
    style.remove();
  }, 1000);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'animateSnippet') {
    const selectionPosition = lastSelectionPosition || getSelectionPosition();
    if (!selectionPosition) {
      throw new Error('Animation requires a selection position.');
    }
    createAnimationElement(request.text, selectionPosition.x, selectionPosition.y);
    lastSelectionPosition = null;
  }
});
