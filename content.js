// ─── Page content extraction (top frame only) ────────────────────────────────
if (window === window.top) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_CONTENT') {
      try {
        const cloneDoc = document.cloneNode(true);
        cloneDoc.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
        const rawText = (cloneDoc.body?.innerText || document.body.innerText || '')
          .replace(/\n{3,}/g, '\n\n').trim();
        const text = rawText.length > 15000
          ? rawText.slice(0, 15000) + '\n\n[...page truncated for length...]'
          : rawText;
        const meta =
          document.querySelector('meta[name="description"]')?.content ||
          document.querySelector('meta[property="og:description"]')?.content || '';
        sendResponse({ title: document.title, url: location.href, text, metaDescription: meta });
      } catch (e) {
        sendResponse({ error: e.message, title: document.title, url: location.href, text: '' });
      }
      return true;
    }
  });
}

// ─── Selection tooltip ────────────────────────────────────────────────────────
// Skip: chrome:// pages, claude.ai, and tiny iframe slivers (ads, trackers)
const isSmallFrame = window !== window.top && (window.innerWidth < 200 || window.innerHeight < 100);
if (!location.protocol.startsWith('chrome') && location.hostname !== 'claude.ai' && !isSmallFrame) {
  initTooltip();
}

function initTooltip() {
  const isGDocs = location.hostname === 'docs.google.com';

  let tipEl       = null;   // the floating button
  let pendingText = '';     // text to send when user clicks Ask Claude
  let mouseDown   = false;
  let hideTimer   = null;

  // ── Build tooltip element (lazy) ──────────────────────────────────────────
  function tip() {
    if (tipEl) return tipEl;

    tipEl = document.createElement('div');
    tipEl.id = '__ctip__';
    tipEl.style.cssText = `
      position: fixed !important;
      z-index: 2147483647 !important;
      display: none !important;
      background: #1e293b !important;
      color: #f8fafc !important;
      padding: 7px 13px !important;
      border-radius: 8px !important;
      font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      box-shadow: 0 4px 16px rgba(0,0,0,.4) !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      user-select: none !important;
      pointer-events: auto !important;
      line-height: 1 !important;
      border: none !important;
    `;
    tipEl.textContent = '✦ Ask Claude';

    tipEl.addEventListener('mouseover',  () => tipEl.style.setProperty('background', '#334155', 'important'));
    tipEl.addEventListener('mouseout',   () => tipEl.style.setProperty('background', '#1e293b', 'important'));

    tipEl.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      let text = pendingText;
      if (!text) text = await grabViaClipboard();

      forceHide();
      if (text && text.trim().length >= 2) {
        chrome.runtime.sendMessage({
          type: 'OPEN_WITH_SELECTION',
          text: text.trim(),
          url: location.href,
          title: document.title,
        });
      }
    });

    // Append to <html> so it works even if <body> is replaced/cleared
    document.documentElement.appendChild(tipEl);
    return tipEl;
  }

  function showAt(centerX, topY) {
    const t = tip();
    // Show first so we can measure width
    t.style.setProperty('display', 'block', 'important');
    const w  = t.getBoundingClientRect().width || 110;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(centerX - w / 2, 6), vw - w - 6);
    const top  = topY - 44 < 6 ? topY + 16 : topY - 40; // flip below if near top
    t.style.setProperty('left',  left + 'px', 'important');
    t.style.setProperty('top',   Math.min(Math.max(top, 6), vh - 40) + 'px', 'important');
  }

  function forceHide() {
    clearTimeout(hideTimer);
    if (tipEl) tipEl.style.setProperty('display', 'none', 'important');
    pendingText = '';
  }

  function softHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(forceHide, 120); // short grace period
  }

  async function grabViaClipboard() {
    try {
      document.execCommand('copy');
      await new Promise(r => setTimeout(r, 120));
      return await navigator.clipboard.readText();
    } catch { return ''; }
  }

  // ── Strategy A: selectionchange (standard pages) ──────────────────────────
  // selectionchange fires at the OS/browser level — pages cannot stop it.
  // We debounce so it only triggers once the user finishes selecting.
  let selTimer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    if (mouseDown) return;          // still dragging — wait for mouseup
    selTimer = setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length >= 2 && sel.rangeCount > 0) {
        pendingText = text;
        clearTimeout(hideTimer);
        try {
          const r = sel.getRangeAt(0).getBoundingClientRect();
          if (r.width > 0 || r.height > 0) {
            showAt(r.left + r.width / 2, r.top);
            return;
          }
        } catch {}
      }
      // Selection gone
      softHide();
    }, 80);
  });

  // mousedown/up just track drag state so selectionchange knows when to fire
  document.addEventListener('mousedown', (e) => {
    mouseDown = true;
    if (tipEl && !tipEl.contains(e.target)) softHide();
  }, true);

  document.addEventListener('mouseup', (e) => {
    mouseDown = false;
    if (tipEl?.contains(e.target)) return;
    // Manually trigger the selectionchange check after mouse release
    clearTimeout(selTimer);
    setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length >= 2 && sel.rangeCount > 0) {
        pendingText = text;
        clearTimeout(hideTimer);
        try {
          const r = sel.getRangeAt(0).getBoundingClientRect();
          showAt(r.left + r.width / 2, r.top);
        } catch { showAt(e.clientX, e.clientY); }
      }
    }, 60);
  }, true);

  document.addEventListener('keydown',  forceHide, true);
  document.addEventListener('scroll',   softHide,  { passive: true });

  // ── Strategy B: Google Docs MutationObserver ──────────────────────────────
  // Google Docs renders selection as `.kix-selection-overlay` divs.
  // Watching for them is more reliable than getSelection() in this editor.
  if (isGDocs) {
    let docsHideTimer = null;
    const obs = new MutationObserver(() => {
      const overlays = document.querySelectorAll('.kix-selection-overlay');
      if (overlays.length > 0) {
        clearTimeout(docsHideTimer);
        clearTimeout(hideTimer);
        pendingText = ''; // clipboard fallback on click
        // Position near the FIRST (topmost) overlay
        const rects = [...overlays].map(o => o.getBoundingClientRect()).filter(r => r.width > 0);
        if (rects.length > 0) {
          const top = Math.min(...rects.map(r => r.top));
          const relevant = rects.find(r => r.top === top);
          showAt(relevant.left + relevant.width / 2, top);
        }
      } else {
        // Overlays removed — may be transient during Google Docs re-render,
        // so wait a tick before hiding
        clearTimeout(docsHideTimer);
        docsHideTimer = setTimeout(() => {
          if (!document.querySelectorAll('.kix-selection-overlay').length) {
            forceHide();
          }
        }, 250);
      }
    });

    // Start observing once the body is ready
    function startGDocsObserver() {
      if (document.body) {
        obs.observe(document.body, { childList: true, subtree: true });
      } else {
        setTimeout(startGDocsObserver, 150);
      }
    }
    startGDocsObserver();
  }
}
