export function toolStatus(status) {
  const alertBox = document.querySelector('.alertBox');
  const scrollText = alertBox.querySelector('.scrollText');

  if (!status || status.trim() === '') {
    alertBox.classList.remove('active');
    return;
  }

  let fullText = '';
  while (fullText.length < 500) {
    fullText += status + '  ///  ';
  }
  fullText = fullText.slice(0, 500);

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

// --- Extended UI helpers originally owned by app.js ---

const defaultWindow = typeof window !== 'undefined'
  ? window
  : { innerWidth: 0, innerHeight: 0, devicePixelRatio: 1 };

const subtitleConfig = {
  typingSpeed: 50,
  glowAmount: 0,
  fontSize: 22,
  fontFamily: "Jost",
  textColor: "#ffffff",
  glowColor: "#5ce600",
  charSpacing: 1.85,
  lineHeight: 1.4,
  cursorBlinkSpeed: 530,
  initialDelay: 300,
  maxLines: 2,
  maxTextWidth: 0.5,
  pagePauseMs: 1500,
  fadeOutDelay: 1500,
  transitionDuration: 900
};

let subtitleViewportWidth = defaultWindow.innerWidth || 0;
let subtitleViewportHeight = defaultWindow.innerHeight || 0;
let subtitleCanvas = null;
let subtitleCtx = null;
let subtitleReady = false;
let subtitleIsTyping = false;
let subtitleIsPagePause = false;
let subtitlePageStart = 0;
let subtitleNextPageStart = null;
let subtitleCurrentText = '';
let subtitleTargetText = '';
let subtitleCharIndex = 0;
let subtitleTypingInterval = null;
let subtitleCursorVisible = true;
let subtitleCursorInterval = null;
let prevSubtitle = null;
let subtitleAutoFadeTimer = null;
let subtitleIsStatus = false;
let subtitleAgentTalking = false;

let microphoneErrorOccurred = false;

function performanceNow() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

function wrapTextIndices(text, maxWidth) {
  if (!subtitleCtx) return [];

  const lines = [];
  let lineStart = 0;
  let lineText = '';
  let lineEnd = 0;

  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      tokens.push({ word: '\n', start: i, end: i + 1, newline: true });
      i++;
      continue;
    }
    while (i < text.length && text[i] === ' ') i++;
    const wordStart = i;
    while (i < text.length && text[i] !== ' ' && text[i] !== '\n') i++;
    const wordEnd = i;
    const word = text.slice(wordStart, wordEnd);
    if (word) tokens.push({ word, start: wordStart, end: wordEnd });
    while (i < text.length && text[i] === ' ') i++;
  }

  let firstInLine = true;
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok.newline) {
      if (lineText) {
        lines.push({ start: lineStart, end: lineEnd, text: lineText });
      }
      lineText = '';
      firstInLine = true;
      lineStart = tok.end;
      lineEnd = tok.end;
      continue;
    }
    const candidate = firstInLine ? tok.word : (lineText + ' ' + tok.word);
    const width = subtitleCtx.measureText(candidate).width;
    if (!firstInLine && width > maxWidth) {
      lines.push({ start: lineStart, end: lineEnd, text: lineText });
      lineText = tok.word;
      lineStart = tok.start;
      lineEnd = tok.end;
      firstInLine = false;
    } else {
      lineText = candidate;
      if (firstInLine) {
        lineStart = tok.start;
        firstInLine = false;
      }
      lineEnd = tok.end;
    }
  }
  if (lineText) {
    lines.push({ start: lineStart, end: lineEnd, text: lineText });
  }
  return lines;
}

function getVisibleSubtitleText() {
  if (!subtitleCtx) return '';
  if (subtitleTargetText && subtitleCharIndex > 0) {
    return subtitleTargetText.slice(subtitlePageStart, subtitleCharIndex);
  }
  return subtitleCurrentText || '';
}

function drawSubtitle(text, x, y, showCursor = false) {
  if (!subtitleCtx) return;

  subtitleCtx.font = `${subtitleConfig.fontSize}px ${subtitleConfig.fontFamily}`;
  subtitleCtx.textAlign = 'center';
  subtitleCtx.textBaseline = 'middle';

  const maxWidth = subtitleViewportWidth * subtitleConfig.maxTextWidth;
  const prefix = subtitlePageStart > 0 ? '... ' : '';
  const display = prefix + text;
  const linesAll = wrapTextIndices(display, maxWidth);
  const linesToDraw = linesAll.slice(0, Math.min(subtitleConfig.maxLines, linesAll.length));

  if (showCursor && subtitleCursorVisible && linesToDraw.length > 0) {
    const lastIdx = linesToDraw.length - 1;
    linesToDraw[lastIdx] = {
      start: linesToDraw[lastIdx].start,
      end: linesToDraw[lastIdx].end,
      text: linesToDraw[lastIdx].text + '|'
    };
  }

  const totalHeight = linesToDraw.length * subtitleConfig.fontSize * subtitleConfig.lineHeight;
  const startY = y - (totalHeight / 2);

  linesToDraw.forEach((lineObj, index) => {
    const lineY = startY + (index * subtitleConfig.fontSize * subtitleConfig.lineHeight);
    subtitleCtx.shadowBlur = 0;
    subtitleCtx.fillStyle = subtitleConfig.textColor;
    subtitleCtx.fillText(lineObj.text, x, lineY);
  });
}

function drawSubtitlePlain(text, x, y) {
  if (!subtitleCtx) return;

  subtitleCtx.font = `${subtitleConfig.fontSize}px ${subtitleConfig.fontFamily}`;
  subtitleCtx.textAlign = 'center';
  subtitleCtx.textBaseline = 'middle';

  const maxWidth = subtitleViewportWidth * subtitleConfig.maxTextWidth;
  const linesAll = wrapTextIndices(text, maxWidth);
  const linesToDraw = linesAll.slice(0, Math.min(subtitleConfig.maxLines, linesAll.length));
  const totalHeight = linesToDraw.length * subtitleConfig.fontSize * subtitleConfig.lineHeight;
  const startY = y - (totalHeight / 2);

  linesToDraw.forEach((lineObj, index) => {
    const lineY = startY + (index * subtitleConfig.fontSize * subtitleConfig.lineHeight);
    subtitleCtx.shadowBlur = 0;
    subtitleCtx.fillStyle = subtitleConfig.textColor;
    subtitleCtx.fillText(lineObj.text, x, lineY);
  });
}

export function cancelSubtitleAutoFade() {
  if (subtitleAutoFadeTimer) {
    clearTimeout(subtitleAutoFadeTimer);
    subtitleAutoFadeTimer = null;
  }
}

export function scheduleSubtitleFadeAfter(delayMs = subtitleConfig.fadeOutDelay, fadeDurationMs = 800) {
  cancelSubtitleAutoFade();
  subtitleAutoFadeTimer = setTimeout(() => {
    subtitleAutoFadeTimer = null;
    if (!subtitleIsStatus && !subtitleAgentTalking && !subtitleIsTyping && (getVisibleSubtitleText() || '').trim().length > 0) {
      fadeOutSubtitle(fadeDurationMs);
    }
  }, delayMs);
}

export function fadeOutSubtitle(duration = 800) {
  const prevVisible = (getVisibleSubtitleText() || '').trim();
  if (!prevVisible) return;

  const bottomY = subtitleViewportHeight * 0.85;

  abortSubtitleTyping();
  subtitleCurrentText = '';
  subtitleTargetText = '';
  subtitleCharIndex = 0;
  subtitlePageStart = 0;
  subtitleIsPagePause = false;
  prevSubtitle = {
    text: prevVisible,
    start: performanceNow(),
    duration: duration,
    yStart: bottomY,
    yEnd: bottomY
  };
}

export function redrawSubtitle() {
  if (!subtitleCtx) return;

  subtitleCtx.clearRect(0, 0, subtitleViewportWidth, subtitleViewportHeight);

  if (prevSubtitle && prevSubtitle.text) {
    const now = performanceNow();
    const duration = prevSubtitle.duration || subtitleConfig.transitionDuration;
    const t = Math.max(0, Math.min(1, (now - prevSubtitle.start) / duration));

    const ease = 1 - Math.pow(1 - t, 3);
    const y = prevSubtitle.yStart + (prevSubtitle.yEnd - prevSubtitle.yStart) * ease;
    const alpha = 1 - ease;

    subtitleCtx.save();
    subtitleCtx.globalAlpha = alpha;
    drawSubtitlePlain(prevSubtitle.text, subtitleViewportWidth / 2, y);
    subtitleCtx.restore();

    if (t >= 1) prevSubtitle = null;
  }

  if (subtitleCurrentText || subtitleIsTyping) {
    const y = subtitleViewportHeight * 0.85;
    const visibleText = subtitleTargetText.slice(subtitlePageStart, subtitleCharIndex);
    drawSubtitle(visibleText, subtitleViewportWidth / 2, y, subtitleIsTyping && !subtitleIsPagePause);
  }
}

function checkSubtitlePageOverflow() {
  if (!subtitleCtx) return;

  subtitleCtx.font = `${subtitleConfig.fontSize}px ${subtitleConfig.fontFamily}`;
  const maxWidth = subtitleViewportWidth * subtitleConfig.maxTextWidth;
  const prefix = subtitlePageStart > 0 ? '... ' : '';
  const display = prefix + subtitleTargetText.slice(subtitlePageStart, subtitleCharIndex);
  const lines = wrapTextIndices(display, maxWidth);

  if (lines.length > subtitleConfig.maxLines && !subtitleIsPagePause) {
    const thirdLineStartInDisplay = lines[subtitleConfig.maxLines].start;
    const prefixLen = subtitlePageStart > 0 ? prefix.length : 0;
    subtitleNextPageStart = subtitlePageStart + Math.max(0, thirdLineStartInDisplay - prefixLen);
    subtitleIsPagePause = true;
    setTimeout(() => {
      subtitlePageStart = subtitleNextPageStart ?? subtitlePageStart;
      subtitleIsPagePause = false;
    }, subtitleConfig.pagePauseMs);
  }
}

function startSubtitleTyping(text) {
  if (subtitleIsTyping) return;

  const withNewlines = text.replace(/\.(?!\.)\s*/g, '.\n');
  subtitleTargetText = withNewlines.trim();
  if (!subtitleTargetText) return;

  subtitleCurrentText = '';
  subtitleCharIndex = 0;
  subtitlePageStart = 0;
  subtitleIsPagePause = false;
  subtitleIsTyping = true;

  subtitleCursorVisible = true;
  if (subtitleCursorInterval) clearInterval(subtitleCursorInterval);
  subtitleCursorInterval = setInterval(() => {
    if (subtitleIsTyping) {
      subtitleCursorVisible = !subtitleCursorVisible;
      redrawSubtitle();
    }
  }, subtitleConfig.cursorBlinkSpeed);

  setTimeout(() => {
    if (subtitleTypingInterval) clearInterval(subtitleTypingInterval);
    subtitleTypingInterval = setInterval(() => {
      if (subtitleIsPagePause) return;
      if (subtitleCharIndex < subtitleTargetText.length) {
        subtitleCurrentText = subtitleTargetText.slice(0, subtitleCharIndex + 1);
        subtitleCharIndex++;
        checkSubtitlePageOverflow();
        redrawSubtitle();
      } else {
        stopSubtitleTyping();
      }
    }, subtitleConfig.typingSpeed);
  }, subtitleConfig.initialDelay);
}

function stopSubtitleTyping() {
  subtitleIsTyping = false;
  if (subtitleTypingInterval) {
    clearInterval(subtitleTypingInterval);
    subtitleTypingInterval = null;
  }
  if (subtitleCursorInterval) {
    clearInterval(subtitleCursorInterval);
    subtitleCursorInterval = null;
  }
  subtitleCursorVisible = false;

  scheduleSubtitleFadeAfter();
}

function abortSubtitleTyping() {
  subtitleIsTyping = false;
  if (subtitleTypingInterval) {
    clearInterval(subtitleTypingInterval);
    subtitleTypingInterval = null;
  }
  if (subtitleCursorInterval) {
    clearInterval(subtitleCursorInterval);
    subtitleCursorInterval = null;
  }
  subtitleCursorVisible = false;
}

export function showSubtitle(text) {
  cancelSubtitleAutoFade();
  if (!text || text.trim().length === 0) {
    fadeOutSubtitle(700);
    return;
  }

  const bracketMatch = text.match(/^\[(.*)\]$/);
  const isStatus = !!bracketMatch;
  let displayText = isStatus ? bracketMatch[1] : text;
  subtitleIsStatus = isStatus;

  if (!isStatus) {
    const prevVisible = subtitleTargetText
      ? subtitleTargetText.slice(subtitlePageStart, subtitleCharIndex)
      : (subtitleCurrentText || '');

    if (prevVisible && prevVisible.trim().length > 0 && subtitleCtx) {
      subtitleCtx.font = `${subtitleConfig.fontSize}px ${subtitleConfig.fontFamily}`;
      const maxWidth = subtitleViewportWidth * subtitleConfig.maxTextWidth;
      const linesAll = wrapTextIndices(prevVisible, maxWidth);
      const linesToDraw = linesAll.slice(0, Math.min(subtitleConfig.maxLines, linesAll.length));
      const totalHeight = linesToDraw.length * subtitleConfig.fontSize * subtitleConfig.lineHeight;
      const bottomY = subtitleViewportHeight * 0.85;
      prevSubtitle = {
        text: prevVisible,
        start: performanceNow(),
        duration: subtitleConfig.transitionDuration,
        yStart: bottomY,
        yEnd: bottomY - totalHeight - 8
      };
    }
  }

  abortSubtitleTyping();
  subtitleCurrentText = '';
  subtitleTargetText = '';
  subtitleCharIndex = 0;
  subtitlePageStart = 0;
  subtitleIsPagePause = false;

  if (isStatus) {
    subtitleTargetText = displayText.trim();
    subtitleCharIndex = subtitleTargetText.length;
    redrawSubtitle();
  } else {
    startSubtitleTyping(displayText);
  }
}

export function initSubtitleCanvas() {
  if (subtitleReady) return;
  if (typeof document === 'undefined') return;

  subtitleCanvas = document.createElement('canvas');
  subtitleCanvas.id = 'subtitleCanvas';
  subtitleCanvas.style.position = 'fixed';
  subtitleCanvas.style.top = '0';
  subtitleCanvas.style.left = '0';
  subtitleCanvas.style.pointerEvents = 'none';
  subtitleCanvas.style.zIndex = '1000';

  document.body.appendChild(subtitleCanvas);
  subtitleCtx = subtitleCanvas.getContext('2d');
  subtitleReady = true;

  if (typeof window !== 'undefined') {
    subtitleViewportWidth = window.innerWidth;
    subtitleViewportHeight = window.innerHeight;
  }
  updateSubtitleCanvasSize(subtitleViewportWidth, subtitleViewportHeight);
}

export function updateSubtitleCanvasSize(width, height) {
  subtitleViewportWidth = width;
  subtitleViewportHeight = height;

  if (!subtitleCanvas || !subtitleCtx) return;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
  subtitleCanvas.style.width = `${width}px`;
  subtitleCanvas.style.height = `${height}px`;

  subtitleCanvas.width = Math.floor(width * dpr);
  subtitleCanvas.height = Math.floor(height * dpr);

  subtitleCtx.setTransform(1, 0, 0, 1, 0, 0);
  subtitleCtx.scale(dpr, dpr);
  redrawSubtitle();
}

export function loaderStatus(statusText) {
  const txt = (statusText || '').toString().trim();
  if (!txt) return;

  const statusDisplay = document.getElementById('statusDisplay');
  const statusTextEl = document.getElementById('statusText');
  if (statusDisplay && statusTextEl) {
    statusDisplay.classList.add('active');
    statusTextEl.textContent = txt;
  }
}

export function hideStatusDisplay() {
  const statusDisplay = document.getElementById('statusDisplay');
  if (!statusDisplay) return;

  const statusTextEl = document.getElementById('statusText');
  if (statusTextEl) {
    statusTextEl.style.opacity = '0';
  }
  setTimeout(() => {
    statusDisplay.classList.remove('active');
    if (statusTextEl) {
      statusTextEl.style.opacity = '1';
    }
  }, 300);
}

export function showAppStatus(text) {
  const raw = (text || '').toString();
  if (!raw.trim()) return;

  if (subtitleReady && subtitleCtx) {
    const bracketed = /^\[.*\]$/.test(raw) ? raw : `[${raw}]`;
    showSubtitle(bracketed);
  } else {
    loaderStatus(raw.replace(/^\[|\]$/g, ''));
  }
}

export function showMicrophoneError(errorType) {
  microphoneErrorOccurred = true;

  const errorMessages = {
    'no_microphone': 'No microphone detected',
    'stereo_mix': 'Line-in input not supported',
    'permission_denied': 'Allow microphone access to begin',
    'media_api_unavailable': 'Browser does not support audio',
    'microphone_in_use': 'Microphone is in use',
    'no_audio_input': 'No audio input device found'
  };
  const message = errorMessages[errorType] || 'Microphone error';

  const statusDisplay = document.getElementById('statusDisplay');
  const statusTextEl = document.getElementById('statusText');
  if (statusDisplay && statusTextEl) {
    statusDisplay.classList.add('active');
    statusTextEl.textContent = message;
    statusDisplay.setAttribute('data-error-type', errorType);
  }

  if (typeof window !== 'undefined' && window.debugLog) {
    window.debugLog(`MICROPHONE ERROR: ${errorType} - ${message}`, 'system');
  }

  return false;
}

export function hasMicrophoneError() {
  return microphoneErrorOccurred;
}

export function setSubtitleAgentTalking(value) {
  subtitleAgentTalking = !!value;
}

function pingToBars(p) {
  if (p <= 0 || !isFinite(p)) return 0;
  if (p <= 300) return 5;
  if (p >= 3000) return 1;
  const norm = (3000 - p) / (3000 - 300);
  return Math.max(1, Math.min(5, 1 + Math.round(norm * 4)));
}

export function updateConnectionQualityUI(pingMs) {
  const root = document.getElementById('connectionQuality');
  if (!root) return;

  const bars = pingToBars(pingMs);

  try { root.title = `ping: ${Math.round(pingMs)}ms`; } catch (_) { }

  root.classList.remove('weak', 'fair', 'good', 'strong');
  if (bars >= 5) root.classList.add('strong');
  else if (bars === 4) root.classList.add('good');
  else if (bars === 3) root.classList.add('fair');
  else if (bars <= 2 && bars >= 1) root.classList.add('weak');

  const elBars = root.querySelectorAll('.bar');
  elBars.forEach((el, idx) => {
    if (idx < bars) el.classList.add('active');
    else el.classList.remove('active');
  });
}
