// Page UI bootstrap: text input window, debug console, top-right controls, language overlay

// Text Input Window
(function () {
  const textWindow = document.getElementById('textInputWindow');
  const textInputArea = document.getElementById('textInputArea');
  const sendTextBtn = document.getElementById('sendTextBtn');
  const clearTextBtn = document.getElementById('clearTextBtn');
  const closeTextInput = document.getElementById('closeTextInput');
  const resetTextInput = document.getElementById('resetTextInput');
  const header = document.getElementById('textInputHeader');

  if (!textWindow) return;

  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;

  // Store default dimensions
  const defaultWidth = 400;
  const defaultHeight = 300;

  function centerWindow() {
    const windowWidth = textWindow.offsetWidth;
    const windowHeight = textWindow.offsetHeight;
    const left = (window.innerWidth - windowWidth) / 2;
    const top = (window.innerHeight - windowHeight) / 2;
    textWindow.style.left = left + 'px';
    textWindow.style.top = top + 'px';
  }

  function resetWindow() {
    textWindow.style.width = defaultWidth + 'px';
    textWindow.style.height = defaultHeight + 'px';
    centerWindow();
    saveState();
  }

  centerWindow();

  // Restore window state
  const savedState = localStorage.getItem('textInputWindowState');
  if (savedState) {
    try {
      const state = JSON.parse(savedState);
      if (state.visible) {
        textWindow.style.display = 'block';
        setTimeout(() => textInputArea && textInputArea.focus(), 100);
      }
      if (state.left !== undefined && state.top !== undefined) {
        textWindow.style.left = state.left + 'px';
        textWindow.style.top = state.top + 'px';
      }
      if (state.width && state.height) {
        textWindow.style.width = state.width + 'px';
        textWindow.style.height = state.height + 'px';
      }
    } catch (e) {
      console.error('Failed to restore text input window state:', e);
    }
  }

  function saveState() {
    const state = {
      visible: textWindow.style.display === 'block',
      left: parseInt(textWindow.style.left) || 0,
      top: parseInt(textWindow.style.top) || 0,
      width: textWindow.offsetWidth,
      height: textWindow.offsetHeight
    };
    localStorage.setItem('textInputWindowState', JSON.stringify(state));
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (textWindow.style.display === 'none' || !textWindow.style.display) {
        textWindow.style.display = 'block';
        textInputArea && textInputArea.focus();
      } else {
        textWindow.style.display = 'none';
      }
      saveState();
    }
  });

  async function sendMessage() {
    const message = (textInputArea?.value || '').trim();
    if (message && window.conversation) {
      try {
        if (window.imageGallery) {
          window.imageGallery.fadeOutSequentially();
          if (window.debugLog) window.debugLog('GALLERY: Fading out images on user text message', 'system');
        }
        await window.conversation.sendUserMessage(message);
        if (textInputArea) textInputArea.value = '';
      } catch (error) {
        console.error('Failed to send message:', error);
      }
    }
  }

  sendTextBtn && sendTextBtn.addEventListener('click', sendMessage);
  clearTextBtn && clearTextBtn.addEventListener('click', function () {
    if (textInputArea) {
      textInputArea.value = '';
      textInputArea.focus();
    }
  });
  closeTextInput && closeTextInput.addEventListener('click', function () {
    textWindow.style.display = 'none';
    saveState();
  });
  resetTextInput && resetTextInput.addEventListener('click', function () {
    resetWindow();
  });

  textInputArea && textInputArea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  header && header.addEventListener('dblclick', function (e) {
    if (e.target === header || (e.target && e.target.parentElement === header)) {
      resetWindow();
    }
  });

  header && header.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  function dragStart(e) {
    const rect = textWindow.getBoundingClientRect();
    initialX = e.clientX - rect.left;
    initialY = e.clientY - rect.top;
    if (e.target === header || (e.target && e.target.parentElement === header)) {
      isDragging = true;
    }
  }
  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      currentX = Math.max(0, currentX);
      currentY = Math.max(0, currentY);
      textWindow.style.left = currentX + 'px';
      textWindow.style.top = currentY + 'px';
    }
  }
  function dragEnd() {
    isDragging = false;
    saveState();
  }

  const resizeObserver = new ResizeObserver(() => {
    saveState();
  });
  resizeObserver.observe(textWindow);
})();

// Debug Console + Call Controls
(function () {
  const debugConsole = document.getElementById('debugConsole');
  const debugLog = document.getElementById('debugLog');
  const closeDebugConsole = document.getElementById('closeDebugConsole');
  const resetDebugConsole = document.getElementById('resetDebugConsole');
  const debugHeader = document.getElementById('debugHeader');
  if (!debugConsole) return;

  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;

  const defaultWidth = 500;
  const defaultHeight = 400;

  function centerWindow() {
    const windowWidth = debugConsole.offsetWidth;
    const windowHeight = debugConsole.offsetHeight;
    const left = (window.innerWidth - windowWidth) / 2;
    const top = (window.innerHeight - windowHeight) / 2;
    debugConsole.style.left = left + 'px';
    debugConsole.style.top = top + 'px';
  }

  function resetWindow() {
    debugConsole.style.width = defaultWidth + 'px';
    debugConsole.style.height = defaultHeight + 'px';
    centerWindow();
    saveState();
  }

  centerWindow();

  const savedState = localStorage.getItem('debugConsoleState');
  if (savedState) {
    try {
      const state = JSON.parse(savedState);
      if (state.visible) {
        debugConsole.style.display = 'block';
      }
      if (state.left !== undefined && state.top !== undefined) {
        debugConsole.style.left = state.left + 'px';
        debugConsole.style.top = state.top + 'px';
      }
      if (state.width && state.height) {
        debugConsole.style.width = state.width + 'px';
        debugConsole.style.height = state.height + 'px';
      }
    } catch (e) {
      console.error('Failed to restore debug console state:', e);
    }
  }

  function saveState() {
    const state = {
      visible: debugConsole.style.display === 'block',
      left: parseInt(debugConsole.style.left) || 0,
      top: parseInt(debugConsole.style.top) || 0,
      width: debugConsole.offsetWidth,
      height: debugConsole.offsetHeight
    };
    localStorage.setItem('debugConsoleState', JSON.stringify(state));
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === '`' || e.key === '~' || e.code === 'Backquote' || e.keyCode === 192) {
      e.preventDefault();
      if (debugConsole.style.display === 'none' || !debugConsole.style.display) {
        debugConsole.style.display = 'block';
      } else {
        debugConsole.style.display = 'none';
      }
      saveState();
    }
  });

  closeDebugConsole && closeDebugConsole.addEventListener('click', function () {
    debugConsole.style.display = 'none';
    saveState();
  });
  resetDebugConsole && resetDebugConsole.addEventListener('click', function () {
    resetWindow();
  });

  debugHeader && debugHeader.addEventListener('dblclick', function (e) {
    if (e.target === debugHeader || (e.target && e.target.parentElement === debugHeader)) {
      resetWindow();
    }
  });

  debugHeader && debugHeader.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  function dragStart(e) {
    const rect = debugConsole.getBoundingClientRect();
    initialX = e.clientX - rect.left;
    initialY = e.clientY - rect.top;
    if (e.target === debugHeader || (e.target && e.target.parentElement === debugHeader)) {
      isDragging = true;
    }
  }
  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      currentX = Math.max(0, currentX);
      currentY = Math.max(0, currentY);
      debugConsole.style.left = currentX + 'px';
      debugConsole.style.top = currentY + 'px';
    }
  }
  function dragEnd() {
    isDragging = false;
    saveState();
  }

  const resizeObserver = new ResizeObserver(() => {
    saveState();
  });
  resizeObserver.observe(debugConsole);

  // Call control buttons
  (function () {
    const muteBtn = document.getElementById('muteBtn');
    const endCallBtn = document.getElementById('endCallBtn');
    if (!muteBtn || !endCallBtn) return;

    let isMuted = false;

    muteBtn.addEventListener('click', function () {
      if (window.conversation) {
        isMuted = !isMuted;
        window.conversation.setMicMuted(isMuted);
        window.conversation.setVolume({ volume: isMuted ? 0 : 1.0 });
        if (isMuted) {
          muteBtn.classList.add('muted');
          muteBtn.querySelector('i')?.classList.remove('fa-microphone');
          muteBtn.querySelector('i')?.classList.add('fa-microphone-slash');
          if (window.conversation.sendContextualUpdate) {
            window.conversation.sendContextualUpdate("User muted the microphone and audio. Don't react to this update.");
            if (window.debugLog) window.debugLog('CONTEXTUAL UPDATE: User muted microphone and audio', 'system');
          }
        } else {
          muteBtn.classList.remove('muted');
          muteBtn.querySelector('i')?.classList.remove('fa-microphone-slash');
          muteBtn.querySelector('i')?.classList.add('fa-microphone');
          if (window.conversation.sendContextualUpdate) {
            window.conversation.sendContextualUpdate("User unmuted the microphone and audio. Don't react to this update.");
            if (window.debugLog) window.debugLog('CONTEXTUAL UPDATE: User unmuted microphone and audio', 'system');
          }
        }
        if (window.debugLog) window.debugLog(`CONTROL: Microphone and audio ${isMuted ? 'muted' : 'unmuted'}`, 'system');
      }
    });

    endCallBtn.addEventListener('click', function () {
      if (window.conversation) {
        if (window.debugLog) window.debugLog('CONTROL: Ending call', 'system');
        window.userRequestedDisconnect = true;
        window.conversation.endSession();
      }
    });
  })();

  // Debug logging function
  window.debugLog = function (message, type = 'system') {
    try {
      const li = document.createElement('li');
      li.className = type + '-message';
      const msg = String(message == null ? '' : message);
      const stripped = msg.replace(/^\s*(?:\[?([A-Z][A-Z ]+)\]?:\s*)+/, '');
      li.textContent = stripped;
      li.title = stripped;
      debugLog && debugLog.appendChild(li);
      const debugContent = document.querySelector('.debug-content');
      if (debugContent) debugContent.scrollTop = debugContent.scrollHeight;
      if (debugLog && debugLog.children.length > 500) {
        debugLog.removeChild(debugLog.firstChild);
      }
    } catch (_) { /* noop */ }
  };
})();

// Top Right Controls
(function () {
  const topRightControls = document.getElementById('topRightControls');
  const toggleDebugBtn = document.getElementById('toggleDebugBtn');
  const toggleTextBtn = document.getElementById('toggleTextBtn');
  const customLanguageSelector = document.getElementById('customLanguageSelector');
  const languageSelectorButton = document.getElementById('languageSelectorButton');
  const languageDropdownMenu = document.getElementById('languageDropdownMenu');
  const currentFlag = document.getElementById('currentFlag');
  const currentLangText = document.getElementById('currentLangText');

  if (!topRightControls) return;

  const langData = {
    'en': { name: 'English', flag: 'gb' },
    'de': { name: 'Deutsch', flag: 'de' },
    'es': { name: 'Español', flag: 'es' },
    'tr': { name: 'Türkçe', flag: 'tr' }
  };

  const currentLang = localStorage.getItem('prefLang') || 'en';
  if (currentFlag) currentFlag.className = `fi fi-${langData[currentLang].flag}`;
  if (currentLangText) currentLangText.textContent = langData[currentLang].name;

  document.querySelectorAll('.lang-option').forEach(option => {
    if (option instanceof HTMLElement && option.dataset.lang === currentLang) {
      option.classList.add('selected');
    }
  });

  languageSelectorButton && languageSelectorButton.addEventListener('click', function (e) {
    e.stopPropagation();
    customLanguageSelector && customLanguageSelector.classList.toggle('open');
  });

  document.addEventListener('click', function (e) {
    if (customLanguageSelector && !customLanguageSelector.contains(e.target)) {
      customLanguageSelector.classList.remove('open');
    }
  });

  languageDropdownMenu && languageDropdownMenu.addEventListener('click', function (e) {
    const option = e.target.closest('.lang-option');
    if (!option) return;
    const lang = option.getAttribute('data-lang');
    const flag = option.getAttribute('data-flag');
    localStorage.setItem('prefLang', lang);
    if (currentFlag) currentFlag.className = `fi fi-${flag}`;
    if (currentLangText) currentLangText.textContent = langData[lang].name;
    document.querySelectorAll('.lang-option').forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');
    // Let the agent know via tool later; page reload handled via tool in app.js
  });

  toggleDebugBtn && toggleDebugBtn.addEventListener('click', function () {
    const debugConsole = document.getElementById('debugConsole');
    if (debugConsole) {
      const isVisible = debugConsole.style.display === 'block';
      debugConsole.style.display = isVisible ? 'none' : 'block';
      toggleDebugBtn.classList.toggle('active', !isVisible);
    }
  });

  toggleTextBtn && toggleTextBtn.addEventListener('click', function () {
    const textWindow = document.getElementById('textInputWindow');
    const textInputArea = document.getElementById('textInputArea');
    if (textWindow) {
      const isVisible = textWindow.style.display === 'block';
      textWindow.style.display = isVisible ? 'none' : 'block';
      toggleTextBtn.classList.toggle('active', !isVisible);
      if (!isVisible && textInputArea) setTimeout(() => textInputArea.focus(), 100);
      const savedState = localStorage.getItem('textInputWindowState');
      if (savedState) {
        try {
          const state = JSON.parse(savedState);
          state.visible = !isVisible;
          localStorage.setItem('textInputWindowState', JSON.stringify(state));
        } catch (e) {
          console.error('Failed to save text input state:', e);
        }
      }
    }
  });

  const debugState = localStorage.getItem('debugConsoleState');
  if (debugState) {
    try {
      const state = JSON.parse(debugState);
      if (state.visible) {
        toggleDebugBtn && toggleDebugBtn.classList.add('active');
      }
    } catch (e) { }
  }

  const textState = localStorage.getItem('textInputWindowState');
  if (textState) {
    try {
      const state = JSON.parse(textState);
      if (state.visible) {
        toggleTextBtn && toggleTextBtn.classList.add('active');
      }
    } catch (e) { }
  }

  window.addEventListener('agent-connected', () => {
    topRightControls && topRightControls.classList.add('connected');
  });
  window.addEventListener('agent-disconnected', () => {
    topRightControls && topRightControls.classList.remove('connected');
  });
})();

// Language Selection Overlay
(function () {
  const languageData = {
    en: {
      desc: "Polished, articulate speech with cultivated charm and quiet authority. Analytical mind with encyclopedic knowledge.",
      tools: "Tools: web search, weather, news, currency, images, earthquakes, music, POI, aircraft, events, calculator, content generation"
    },
    de: {
      desc: "Poetisches, literarisches Deutsch mit Bescheidenheit und Respekt. Gandalf aus Mittelerde.",
      tools: "Werkzeuge: Währungsumrechnung, Name speichern, Sitzung beenden"
    },
    es: {
      desc: "Español poético y reflexivo mit modestia y respeto. Gandalf de la Tierra Media.",
      tools: "Herramientas: conversión de moneda, guardar nombre, cierre de sesión"
    },
    tr: {
      desc: "Şiirsel ve sade Türkçe, tevazu ve saygı ile. Orta Dünya'dan Gandalf.",
      tools: "Araçlar: döviz kuru, isim kaydetme, görüşme sonlandırma"
    }
  };

  const overlay = document.getElementById('languageSelectionOverlay');
  if (!overlay) return;

  const prefLang = localStorage.getItem('prefLang');
  if (!prefLang) {
    overlay.classList.remove('hidden');
    Object.keys(languageData).forEach(lang => {
      const card = document.querySelector(`.language-card[data-lang="${lang}"]`);
      if (card) {
        const descEl = card.querySelector('.language-desc');
        const toolsEl = card.querySelector('.language-tools');
        if (descEl) descEl.textContent = languageData[lang].desc;
        if (toolsEl) toolsEl.textContent = languageData[lang].tools;
      }
    });
    document.querySelectorAll('.language-card').forEach(card => {
      card.addEventListener('click', async function () {
        const selectedLang = this.getAttribute('data-lang');
        localStorage.setItem('prefLang', selectedLang);
        overlay.style.display = 'none';
        if (window.postLangSel) {
          await window.postLangSel();
        }
      });
    });
  } else {
    overlay.style.display = 'none';
  }
})();

