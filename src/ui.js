export function toolStatus(status) {
  const alertBox = document.querySelector('.alertBox');
  const scrollText = alertBox.querySelector('.scrollText');

  if (!status || status.trim() === '') {
    alertBox.classList.remove('active');
    return;
  }

  let fullText = '';
  while (fullText.length < 200) {
    fullText += status + '  ///  ';
  }
  fullText = fullText.slice(0, 200);

  scrollText.textContent = fullText;
  alertBox.classList.add('active');
}

export function showDisconnectionBox() {
  hideDisconnectionBox();

  const box = document.createElement('div');
  box.id = 'disconnectionBox';

  box.textContent = 'Agent is disconnected.';
  const button = document.createElement('button');
  button.textContent = 'Call again';
  const onReconnect = (typeof window !== 'undefined' && window.reconnectAgent) ? window.reconnectAgent : null;
  if (onReconnect) {
    button.onclick = onReconnect;
  }

  box.appendChild(button);
  document.body.appendChild(box);
}

export function hideDisconnectionBox() {
  const box = document.getElementById('disconnectionBox');
  if (box) {
    box.remove();
  }
}

export function updateTopicDisplay(title, tags) {
  const topicTitle = document.getElementById('topicTitle');
  if (topicTitle) topicTitle.textContent = title;
}

export function clearTopicDisplay() {
  const topicTitle = document.getElementById('topicTitle');
  if (topicTitle) topicTitle.textContent = '';
}

export function showCategoryIndicator(category) {
  let indicator = document.getElementById('categoryIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'categoryIndicator';
    document.body.appendChild(indicator);
  }
  indicator.textContent = category;
  indicator.classList.add('show');
}

let notificationContainerEl = null;
function ensureNotificationContainer() {
  if (!notificationContainerEl) {
    notificationContainerEl = document.createElement('div');
    notificationContainerEl.className = 'notification-container';
    document.body.appendChild(notificationContainerEl);
  }
}

export function showNotification(title, description, iconUrl) {
  ensureNotificationContainer();

  const notification = document.createElement('div');
  notification.className = 'notification';

  if (typeof iconUrl !== 'string' || iconUrl.trim() === '') {
    iconUrl = '/static/favicon.ico';
  }

  const icon = document.createElement('img');
  icon.className = 'notification-icon';
  icon.src = iconUrl;

  const textContainer = document.createElement('div');
  textContainer.className = 'notification-text';

  const titleEl = document.createElement('div');
  titleEl.className = 'notification-title';
  titleEl.textContent = title;

  const descEl = document.createElement('div');
  descEl.className = 'notification-description';
  descEl.textContent = description;

  textContainer.appendChild(titleEl);
  textContainer.appendChild(descEl);
  notification.appendChild(icon);
  notification.appendChild(textContainer);

  notificationContainerEl.appendChild(notification);
  if (typeof window !== 'undefined' && window._talk && window._talk.play) {
    try { window._talk.play(); } catch (_) { }
  }
  requestAnimationFrame(() => {
    notification.classList.add('show');
  });

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 500);
  }, 6000);
}

export function handleLink(href, title, target) {
  const ctx = `User opened link: ${title || href}`;
  try { if (window.conversation && window.conversation.sendContextualUpdate) window.conversation.sendContextualUpdate(ctx); } catch (_) { }
  try { if (window.debugLog) window.debugLog(`CONTEXT: ${ctx}`, 'system'); } catch (_) { }
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (typeof window !== 'undefined' && window._action && window._action.play) {
    try { window._action.play(); } catch (_) { }
  }
}

export function initTouchUI(timeoutMs = 5000) {
  const isTouchDevice = ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints > 0);
  if (!isTouchDevice) return;

  const volumeCanvas = document.getElementById('volumeCanvas');
  const callControls = document.getElementById('callControls');
  const topicDisplay = document.getElementById('topicDisplay');
  const topRightControls = document.getElementById('topRightControls');

  let hideTimeout = null;

  function showTouchUI() {
    if (volumeCanvas && volumeCanvas.classList.contains('connected')) {
      volumeCanvas.classList.add('touch-visible');
    }
    if (callControls && callControls.classList.contains('connected')) {
      callControls.classList.add('touch-visible');
    }
    if (topicDisplay && topicDisplay.classList.contains('connected')) {
      topicDisplay.classList.add('touch-visible');
    }
    if (topRightControls && topRightControls.classList.contains('connected')) {
      topRightControls.classList.add('touch-visible');
    }

    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => hideTouchUI(), timeoutMs);
  }

  function hideTouchUI() {
    if (volumeCanvas) volumeCanvas.classList.remove('touch-visible');
    if (callControls) callControls.classList.remove('touch-visible');
    if (topicDisplay) topicDisplay.classList.remove('touch-visible');
    if (topRightControls) topRightControls.classList.remove('touch-visible');
  }

  document.body.addEventListener('touchstart', showTouchUI);
  document.body.addEventListener('click', showTouchUI);
  window.addEventListener('agent-connected', () => showTouchUI());
  window.addEventListener('agent-disconnected', () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    hideTouchUI();
  });
}