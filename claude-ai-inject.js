// Runs on claude.ai — picks up a pending sidebar export and injects it into the editor.

const EXPORT_KEY = 'claudeAiExport';
const MAX_AGE_MS = 30_000;

async function tryInject() {
  const result = await chrome.storage.local.get(EXPORT_KEY);
  const data = result[EXPORT_KEY];
  if (!data || Date.now() - data.ts > MAX_AGE_MS) return;

  await chrome.storage.local.remove(EXPORT_KEY);

  // Wait for the ProseMirror editor to appear (claude.ai is a React SPA)
  const editor = await waitFor(
    () => document.querySelector('div[contenteditable="true"][data-placeholder]')
      || document.querySelector('div[contenteditable="true"]')
      || document.querySelector('fieldset div[contenteditable]'),
    12000
  );
  if (!editor) return;

  await sleep(600); // Let React fully mount

  injectText(editor, data.transcript);
}

function injectText(el, text) {
  el.focus();

  // ProseMirror / React editors respond best to a synthetic paste event
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
    return;
  } catch {}

  // Fallback: execCommand insertText
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    return;
  } catch {}

  // Last resort: set innerHTML (loses formatting but works)
  el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function waitFor(fn, timeout = 10000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      const r = fn();
      if (r) { resolve(r); return; }
      if (Date.now() - start > timeout) { resolve(null); return; }
      setTimeout(check, 250);
    };
    check();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Run on all claude.ai pages — the MAX_AGE_MS guard prevents stale injections
tryInject();
