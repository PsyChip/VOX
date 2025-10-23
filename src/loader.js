/* Lightweight client bootstrapper: run capability checks first, then sideload heavy assets. */
(function () {
  function setStatus(text) {
    try {
      const statusDisplay = document.getElementById('statusDisplay');
      const statusText = document.getElementById('statusText');
      if (statusDisplay && statusText) {
        statusDisplay.classList.add('active');
        statusText.textContent = String(text || '').trim();
      }
    } catch (_) { /* noop */ }
  }

  function setProgress(pct) {
    try {
      const statusDisplay = document.getElementById('statusDisplay');
      if (statusDisplay) statusDisplay.classList.add('active');
      // Ensure progress elements exist (use new ids to avoid cached ring CSS)
      let root = document.getElementById('statusLinear');
      let bar = document.getElementById('statusLinearBar');
      if (!root) {
        root = document.createElement('div');
        root.id = 'statusLinear';
        bar = document.createElement('div');
        bar.id = 'statusLinearBar';
        root.appendChild(bar);
        const statusText = document.getElementById('statusText');
        const parent = statusText ? statusText.parentElement : document.body;
        parent && parent.appendChild(root);
      }
      if (!bar) bar = document.getElementById('statusLinearBar');
      const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
      if (bar) bar.style.width = clamped + '%';
      // Fade out the progress bar once it reaches 100%
      if (root) {
        if (clamped >= 100) {
          // Ensure it's visible if previously hidden, then trigger fade-out
          if (root.style.display === 'none') root.style.display = '';
          if (!root.classList.contains('is-done')) {
            // After width animation completes, opacity will fade via CSS
            root.classList.add('is-done');
            // After fade completes, remove from flow to avoid reserving space
            const onEnd = (ev) => {
              if (ev && ev.propertyName !== 'opacity') return;
              root.style.display = 'none';
            };
            root.addEventListener('transitionend', onEnd, { once: true });
          }
        } else {
          // If progress drops below 100, show and reset any fade state
          if (root.style.display === 'none') root.style.display = '';
          root.classList.remove('is-done');
        }
      }
    } catch (_) { /* noop */ }
  }

  function supportsHtml5() {
    const canvas = document.createElement('canvas');
    const canvas2d = !!(canvas && canvas.getContext && canvas.getContext('2d'));
    const features = [
      ['fetch', typeof window.fetch === 'function'],
      ['Promise', typeof window.Promise === 'function'],
      ['WebSocket', typeof window.WebSocket === 'function'],
      ['localStorage', (() => { try { return !!window.localStorage; } catch (_) { return false; } })()],
      ['TextEncoder', typeof window.TextEncoder === 'function'],
      ['TextDecoder', typeof window.TextDecoder === 'function'],
      ['ResizeObserver', typeof window.ResizeObserver === 'function'],
      ['URL', typeof window.URL === 'function'],
      ['Canvas2D', canvas2d]
    ];
    const missing = features.filter(([, ok]) => !ok).map(([name]) => name);
    return { ok: missing.length === 0, missing };
  }

  function hasWebAudioSupport() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    return !!AudioContext;
  }

  function hasMediaApi() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  }

  async function hasMicrophoneDevice() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return { ok: false, reason: 'media api unavailable' };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d && d.kind === 'audioinput');
      if (inputs.length > 0) return { ok: true };
      return { ok: false, reason: 'no input audio source detected' };
    } catch (_) {
      // Some browsers require a prior getUserMedia call before enumerateDevices returns devices
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => { try { t.stop(); } catch (_) { } });
      } catch (e) {
        const name = e && (e.name || e.code) || '';
        if (String(name).toLowerCase().includes('denied')) {
          return { ok: false, reason: 'microphone permission denied' };
        }
        return { ok: false, reason: 'cannot access microphone' };
      }
      try {
        const devices2 = await navigator.mediaDevices.enumerateDevices();
        const inputs2 = devices2.filter(d => d && d.kind === 'audioinput');
        return { ok: inputs2.length > 0, reason: inputs2.length > 0 ? undefined : 'no input audio source detected' };
      } catch (_) {
        return { ok: false, reason: 'unable to enumerate devices' };
      }
    }
  }

  async function hasAudioOutputDevice() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      // Fall back: if WebAudio exists, assume default output exists
      return { ok: hasWebAudioSupport() };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d && d.kind === 'audiooutput');
      if (outputs.length > 0) return { ok: true };
      // Some platforms (iOS/Safari) may not list audiooutput; allow if AudioContext is present
      return { ok: hasWebAudioSupport() };
    } catch (_) {
      return { ok: hasWebAudioSupport() };
    }
  }

  async function ensureMicrophonePermission() {
    // Prefer Permissions API if available
    try {
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        try {
          const status = await navigator.permissions.query({ name: 'microphone' });
          if (status && status.state === 'denied') {
            return { ok: false, reason: 'microphone permission denied' };
          }
          if (status && status.state === 'granted') {
            return { ok: true };
          }
          // state === 'prompt' → request once via gUM
        } catch (_) { /* fall through */ }
      }
    } catch (_) { /* ignore */ }

    // Request a minimal audio stream to confirm capability/permission
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true } });
      try { stream.getTracks().forEach(t => t.stop()); } catch (_) { }
      return { ok: true };
    } catch (e) {
      let reason = 'cannot access microphone';
      const name = e && (e.name || e.code);
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        reason = 'microphone permission denied';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        reason = 'no input audio source detected';
      } else if (name === 'NotReadableError') {
        reason = 'microphone is in use or unavailable';
      }
      return { ok: false, reason };
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // preserve order
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  // (streaming loader removed; using standard <script> for bundle)

  async function loadAssetsWithProgress(urls) {
    const base = 60; // percent when starting asset load
    const span = 40; // reserve for asset loading
    const n = urls.length || 1;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const file = (url.split('/').pop() || url);
      setStatus('loading ' + file);
      await loadScript(url);
      const pct = base + Math.round(((i + 1) / n) * span);
      setProgress(pct);
    }
  }

  async function boot() {
    setStatus('initializing');

    // 1) Check core HTML5 features
    setStatus('checking browser');
    setProgress(5);
    const f = supportsHtml5();
    if (!f.ok) {
      setStatus('browser not supported: ' + f.missing.join(', '));
      return;
    }

    // 2) Check Web Audio + Media APIs present
    if (!hasWebAudioSupport()) {
      setStatus('audio not supported by browser');
      return;
    }
    setProgress(10);
    if (!hasMediaApi()) {
      setStatus('media api unavailable');
      return;
    }
    setProgress(15);

    // 3) Load fonts early to reduce FOIT (non-blocking with timeout)
    try {
      setStatus('loading fonts');
      setProgress(18);
      await (async function ensureFonts(timeoutMs = 3000) {
        // Ensure Google Fonts stylesheet is present or attach it
        const href = 'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700&display=swap';
        let link = document.getElementById('gf-jost');
        if (!link) {
          link = document.createElement('link');
          link.id = 'gf-jost';
          link.rel = 'preload';
          link.as = 'style';
          link.href = href;
          link.onload = function () { try { this.rel = 'stylesheet'; } catch (_) { } };
          document.head.appendChild(link);
        }
        // Wait for fonts if supported, but cap by timeout
        if (document.fonts && document.fonts.load) {
          const weights = ['300', '400', '500', '600', '700'];
          const loads = weights.map(w => document.fonts.load(`normal ${w} 1em Jost`));
          const ready = document.fonts.ready;
          await Promise.race([
            Promise.allSettled(loads).then(() => ready.catch(() => {})),
            new Promise(res => setTimeout(res, timeoutMs))
          ]);
        }
      })();
      setProgress(20);
    } catch (_) {
      // Continue without blocking if fonts fail
    }

    // 4) Check devices: microphone present
    setStatus('checking microphone');
    setProgress(30);
    const micDevices = await hasMicrophoneDevice();
    if (!micDevices.ok) {
      setStatus(micDevices.reason || 'no microphone detected');
      return;
    }

    // 5) Check permission (may prompt once)
    setStatus('requesting microphone');
    setProgress(45);
    const perm = await ensureMicrophonePermission();
    if (!perm.ok) {
      setStatus(perm.reason || 'microphone permission denied');
      return;
    }
    setProgress(50);

    // 6) Check audio output is available
    setStatus('checking audio output');
    setProgress(55);
    const out = await hasAudioOutputDevice();
    if (!out.ok) {
      setStatus('no audio output device');
      return;
    }
    setProgress(60);

    // 7) Load heavy assets only after passing checks
    setStatus('loading assets');
    const assets = [
      // Single unified bundle contains all client-side JS
      '/static/bundle.js'
    ];
    try {
      await loadAssetsWithProgress(assets);
      setProgress(100);
    } catch (e) {
      setStatus('failed to load assets');
      return;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose minimal debug handle
  window.assetLoader = {
    reload: () => boot()
  };
})();
