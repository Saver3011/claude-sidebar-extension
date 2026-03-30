// ─── State ────────────────────────────────────────────────────────────────────
let apiKey = '';
let model  = 'claude-sonnet-4-6';
let chats  = {};         // { [id]: Chat }
let activeId = null;     // null = list view
let isLoading = false;

// Chat shape:
// { id, type('page'|'selection'|'general'), title, url,
//   pageCtx: {title,url,text,meta} | null,
//   selectionCtx: {text,url,title} | null,
//   screenshot: dataUrl | null,   ← in-memory only, not persisted
//   conversation: [{role, content}],
//   createdAt, updatedAt }

const chat  = () => activeId ? chats[activeId] : null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);
const D = {
  backBtn:          el('backBtn'),
  headerLogo:       el('headerLogo'),
  headerChatTitle:  el('headerChatTitle'),
  newChatBtn:       el('newChatBtn'),
  settingsBtn:      el('settingsBtn'),
  settingsPanel:    el('settingsPanel'),
  apiKeyInput:      el('apiKeyInput'),
  modelSelect:      el('modelSelect'),
  saveSettingsBtn:  el('saveSettingsBtn'),
  captureBtnChat:   el('captureBtnChat'),
  exportBtnChat:    el('exportBtnChat'),
  deleteChatBtn:    el('deleteChatBtn'),
  listView:         el('listView'),
  chatListEl:       el('chatListEl'),
  listEmpty:        el('listEmpty'),
  chatView:         el('chatView'),
  contextBanner:    el('contextBanner'),
  contextText:      el('contextText'),
  previewBtn:       el('previewBtn'),
  previewModal:     el('previewModal'),
  previewImage:     el('previewImage'),
  closePreview:     el('closePreview'),
  chatEmptyState:   el('chatEmptyState'),
  chatEmptyText:    el('chatEmptyText'),
  messages:         el('messages'),
  selectionPill:    el('selectionPill'),
  selectionPillText:el('selectionPillText'),
  clearSelectionBtn:el('clearSelectionBtn'),
  userInput:        el('userInput'),
  sendBtn:          el('sendBtn'),
  statusBar:        el('statusBar'),
  openClaudeFooterBtn: el('openClaudeFooterBtn'),
};

// ─── Storage ──────────────────────────────────────────────────────────────────
const sGet = keys => new Promise(r => chrome.storage.local.get(keys, r));
const sSet = obj  => new Promise(r => chrome.storage.local.set(obj, r));

async function loadState() {
  const data = await sGet(['apiKey', 'model', 'chats']);
  if (data.apiKey) { apiKey = data.apiKey; D.apiKeyInput.value = data.apiKey; }
  if (data.model)  { model  = data.model;  D.modelSelect.value = data.model;  }
  if (data.chats)  {
    for (const [id, c] of Object.entries(data.chats)) {
      chats[id] = { ...c, screenshot: null }; // screenshots not persisted
    }
  }
  updateSendBtn();
  showList();
}

async function saveChats() {
  const out = {};
  for (const [id, c] of Object.entries(chats)) {
    out[id] = {
      id: c.id, type: c.type, title: c.title, url: c.url,
      pageCtx: c.pageCtx || null,
      selectionCtx: c.selectionCtx || null,
      // Strip image blobs from conversation before persisting
      conversation: c.conversation.map(m => {
        if (typeof m.content === 'string') return m;
        const text = (m.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
        return { role: m.role, content: text };
      }).filter(m => m.content),
      createdAt: c.createdAt, updatedAt: c.updatedAt,
    };
  }
  await sSet({ chats: out });
}

// ─── Chat operations ──────────────────────────────────────────────────────────
function makeChat(type, opts = {}) {
  const id = 'c_' + Date.now();
  chats[id] = {
    id, type,
    title:        opts.title        || defaultTitle(type, opts),
    url:          opts.url          || '',
    pageCtx:      opts.pageCtx      || null,
    selectionCtx: opts.selectionCtx || null,
    screenshot:   opts.screenshot   || null,
    conversation: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return id;
}

function defaultTitle(type, opts) {
  if (type === 'selection' && opts.selectionCtx?.text)
    return '"' + opts.selectionCtx.text.slice(0, 45) + (opts.selectionCtx.text.length > 45 ? '…' : '') + '"';
  if (type === 'page' && opts.pageCtx?.title) return opts.pageCtx.title;
  if (type === 'page' && opts.url) return opts.url.replace(/^https?:\/\//, '').split('/')[0];
  return 'New chat';
}

function deleteChat(id) {
  delete chats[id];
  saveChats();
  if (activeId === id) showList();
  else renderList();
}

// ─── View: LIST ───────────────────────────────────────────────────────────────
function showList() {
  activeId = null;
  D.listView.classList.remove('hidden');
  D.chatView.classList.add('hidden');
  D.backBtn.classList.add('hidden');
  D.headerLogo.classList.remove('hidden');
  D.headerChatTitle.classList.add('hidden');
  D.newChatBtn.classList.remove('hidden');
  D.settingsBtn.classList.remove('hidden');
  D.captureBtnChat.classList.add('hidden');
  D.exportBtnChat.classList.add('hidden');
  D.deleteChatBtn.classList.add('hidden');
  renderList();
}

function renderList() {
  const sorted = Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt);
  D.chatListEl.innerHTML = '';
  D.listEmpty.classList.toggle('hidden', sorted.length > 0);

  for (const c of sorted) {
    const card = makeCard(c);
    D.chatListEl.appendChild(card);
  }
}

function makeCard(c) {
  const div = document.createElement('div');
  div.className = 'chat-card';

  const lastMsg = c.conversation[c.conversation.length - 1];
  let preview = '';
  if (lastMsg) {
    const txt = typeof lastMsg.content === 'string'
      ? lastMsg.content
      : (lastMsg.content || []).find(p => p.type === 'text')?.text || '';
    preview = txt.replace(/\n/g, ' ').slice(0, 90);
  } else if (c.selectionCtx?.text) {
    preview = c.selectionCtx.text.slice(0, 90);
  } else if (c.url) {
    preview = c.url.replace(/^https?:\/\//, '').slice(0, 60);
  }

  const icons = {
    page:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    selection: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/></svg>`,
    general:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  };

  const badgeLabels = { page: 'Page', selection: 'Selection', general: 'General' };

  div.innerHTML = `
    <div class="card-icon card-icon-${c.type}">${icons[c.type] || icons.general}</div>
    <div class="card-body">
      <div class="card-title">${esc(c.title)}</div>
      ${preview ? `<div class="card-preview">${esc(preview)}</div>` : ''}
      <span class="card-type-badge badge-${c.type}">${badgeLabels[c.type] || c.type}</span>
    </div>
    <div class="card-right">
      <span class="card-time">${timeAgo(c.updatedAt)}</span>
      <button class="card-del-btn" title="Delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;

  div.querySelector('.card-del-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (confirm('Delete this chat?')) deleteChat(c.id);
  });
  div.addEventListener('click', () => openChat(c.id));
  return div;
}

// ─── View: CHAT ───────────────────────────────────────────────────────────────
function openChat(id) {
  activeId = id;
  const c = chat();

  D.listView.classList.add('hidden');
  D.chatView.classList.remove('hidden');
  D.backBtn.classList.remove('hidden');
  D.headerLogo.classList.add('hidden');
  D.headerChatTitle.classList.remove('hidden');
  D.headerChatTitle.textContent = c.title.length > 26 ? c.title.slice(0, 26) + '…' : c.title;
  D.newChatBtn.classList.add('hidden');
  D.settingsBtn.classList.add('hidden');
  D.captureBtnChat.classList.toggle('hidden', c.type === 'selection');
  D.exportBtnChat.classList.remove('hidden');
  D.deleteChatBtn.classList.remove('hidden');

  D.settingsPanel.classList.add('hidden');
  D.previewModal.classList.add('hidden');

  renderMessages();
  updateBanner();
  updateSelectionPill();
  D.userInput.value = c.draft || '';
  autoResize(D.userInput);
  updateSendBtn();
  D.userInput.focus();
}

function renderMessages() {
  const c = chat();
  D.messages.innerHTML = '';

  if (!c || c.conversation.length === 0) {
    D.chatEmptyState.classList.remove('hidden');
    D.openClaudeFooterBtn.classList.add('hidden');
    // Update empty state text based on chat type
    if (c?.type === 'selection') {
      D.chatEmptyText.textContent = 'Ask about the highlighted text…';
    } else if (c?.type === 'page') {
      D.chatEmptyText.textContent = 'Ask anything about this page…';
    } else {
      D.chatEmptyText.textContent = 'Ask anything…';
    }
    return;
  }

  D.chatEmptyState.classList.add('hidden');

  for (const msg of c.conversation) {
    const isUser = msg.role === 'user';
    const text = typeof msg.content === 'string'
      ? msg.content
      : (msg.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
    if (isUser) addUserBubble(text, null, true);
    else addAssistantBubble(text, true);
  }

  D.openClaudeFooterBtn.classList.remove('hidden');
  scrollBottom();
}

function updateBanner() {
  const c = chat();
  if (!c) { D.contextBanner.classList.add('hidden'); return; }

  if (c.type === 'page' && c.pageCtx) {
    const t = c.pageCtx.title || c.url;
    D.contextText.textContent = 'Page: ' + (t.length > 38 ? t.slice(0, 38) + '…' : t);
    D.contextBanner.classList.remove('hidden');
    D.previewBtn.classList.toggle('hidden', !c.screenshot);
  } else if (c.type === 'selection' && c.selectionCtx) {
    const t = c.selectionCtx.text;
    D.contextText.textContent = '"' + (t.length > 42 ? t.slice(0, 42) + '…' : t) + '"';
    D.contextBanner.classList.remove('hidden');
    D.previewBtn.classList.add('hidden');
  } else {
    D.contextBanner.classList.add('hidden');
  }
}

function updateSelectionPill() {
  const c = chat();
  // Show selection pill only if it's a selection chat with no messages yet
  // (as a reminder of context), or if we're adding a selection mid-conversation
  if (c?.type === 'selection' && c.selectionCtx && c.conversation.length === 0) {
    const t = c.selectionCtx.text;
    D.selectionPillText.textContent = '"' + (t.length > 55 ? t.slice(0, 55) + '…' : t) + '"';
    D.selectionPill.classList.remove('hidden');
  } else {
    D.selectionPill.classList.add('hidden');
  }
}

// ─── Send message ─────────────────────────────────────────────────────────────
async function handleSend() {
  const text = D.userInput.value.trim();
  if (!text || isLoading || !activeId) return;
  if (!apiKey) { D.settingsPanel.classList.remove('hidden'); setStatus('Add your API key first.', 'error'); return; }

  const c = chat();
  D.userInput.value = '';
  autoResize(D.userInput);
  if (c.draft) c.draft = '';
  isLoading = true;
  updateSendBtn();
  D.chatEmptyState.classList.add('hidden');
  D.selectionPill.classList.add('hidden');

  const isFirstMessage = c.conversation.length === 0;

  if (c.type === 'page' && isFirstMessage && !c.pageCtx) {
    // Auto-capture for page chats on first message
    setStatus('Capturing page…');
    await captureForChat(activeId);
  }

  // Build user content
  let userContent;
  if (isFirstMessage && c.type === 'page' && c.screenshot) {
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.screenshot.split(',')[1] } },
      { type: 'text', text },
    ];
  } else if (isFirstMessage && c.type === 'selection') {
    userContent = `Regarding this highlighted text:\n\n"${c.selectionCtx?.text}"\n\n${text}`;
  } else {
    userContent = text;
  }

  c.conversation.push({ role: 'user', content: userContent });
  c.updatedAt = Date.now();

  addUserBubble(text, c.type === 'page' && isFirstMessage && c.screenshot ? 'snapshot' : null);

  const typingEl = addTyping();

  try {
    const reply = await callClaude(c);
    typingEl.remove();
    c.conversation.push({ role: 'assistant', content: reply });
    c.updatedAt = Date.now();
    addAssistantBubble(reply);
    D.openClaudeFooterBtn.classList.remove('hidden');
    saveChats();
  } catch (err) {
    typingEl.remove();
    addErrorBubble(err.message);
  }

  isLoading = false;
  updateSendBtn();
  setStatus('');
}

// ─── Page capture ─────────────────────────────────────────────────────────────
async function captureForChat(id) {
  try {
    const [ssRes, contentRes] = await Promise.all([
      bg({ type: 'CAPTURE_SCREENSHOT' }),
      bg({ type: 'GET_PAGE_CONTENT' }),
    ]);
    if (ssRes.error) throw new Error(ssRes.error);

    const c = chats[id];
    c.screenshot = ssRes.dataUrl;
    c.url        = contentRes.url   || ssRes.tabUrl   || c.url;
    c.type       = 'page';
    c.pageCtx    = {
      title: contentRes.title || ssRes.tabTitle || 'Page',
      url:   contentRes.url   || ssRes.tabUrl   || '',
      text:  contentRes.text  || '',
      meta:  contentRes.metaDescription || '',
    };
    if (!c.title || c.title === 'New chat') {
      c.title = c.pageCtx.title;
      if (activeId === id) {
        D.headerChatTitle.textContent = c.title.length > 26 ? c.title.slice(0, 26) + '…' : c.title;
      }
    }
    updateBanner();
    setStatus('');
  } catch (err) {
    setStatus('Capture failed: ' + err.message, 'error');
  }
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(c) {
  setStatus('Thinking…');

  let system = 'You are a helpful assistant embedded in a browser sidebar.';
  if (c.type === 'page' && c.pageCtx) {
    system += `\n\nYou are looking at this webpage:\nURL: ${c.pageCtx.url}\nTitle: ${c.pageCtx.title}\n${c.pageCtx.meta ? 'Description: ' + c.pageCtx.meta + '\n' : ''}\nPage text:\n---\n${c.pageCtx.text || '(none)'}\n---\nThe first message may include a screenshot. Be concise.`;
  } else if (c.type === 'selection' && c.selectionCtx) {
    system += `\n\nThe user highlighted text on: ${c.selectionCtx.url} (${c.selectionCtx.title})\nFocus on the highlighted text in your answers.`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages: c.conversation }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`API ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '(No response)';
}

// ─── Message rendering helpers ────────────────────────────────────────────────
function addUserBubble(text, badge, noScroll) {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-user';
  const label = document.createElement('div');
  label.className = 'msg-label'; label.textContent = 'You';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (badge === 'snapshot') {
    const b = document.createElement('div');
    b.className = 'snapshot-badge';
    b.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/></svg> page snapshot attached`;
    bubble.appendChild(b);
  }
  bubble.appendChild(document.createTextNode(text));
  wrap.appendChild(label); wrap.appendChild(bubble);
  D.messages.appendChild(wrap);
  if (!noScroll) scrollBottom();
}

function addAssistantBubble(text, noScroll) {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant';
  const label = document.createElement('div');
  label.className = 'msg-label'; label.textContent = 'Claude';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = mdToHtml(text);
  wrap.appendChild(label); wrap.appendChild(bubble);
  D.messages.appendChild(wrap);
  if (!noScroll) scrollBottom();
}

function addErrorBubble(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant';
  const label = document.createElement('div'); label.className = 'msg-label'; label.textContent = 'Claude';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble error'; bubble.textContent = 'Error: ' + msg;
  wrap.appendChild(label); wrap.appendChild(bubble);
  D.messages.appendChild(wrap); scrollBottom();
}

function addTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant';
  const label = document.createElement('div'); label.className = 'msg-label'; label.textContent = 'Claude';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
  bubble.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  wrap.appendChild(label); wrap.appendChild(bubble);
  D.messages.appendChild(wrap); scrollBottom();
  return wrap;
}

// ─── Incoming selection (from right-click or tooltip) ─────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  const sel = changes.claudeSelection?.newValue;
  if (sel && Date.now() - sel.ts < 15_000) {
    chrome.storage.local.remove('claudeSelection');
    const id = makeChat('selection', {
      selectionCtx: { text: sel.text, url: sel.url, title: sel.title },
      url: sel.url,
    });
    saveChats();
    openChat(id);
    return;
  }

  const nav = changes.pageNavigated?.newValue;
  if (nav && Date.now() - nav.ts < 5_000) {
    chrome.storage.local.remove('pageNavigated');
    handlePageNavigation(nav.url, nav.windowId);
  }
});

// Check on open (selection may have been set before listener was ready)
chrome.storage.local.get('claudeSelection', res => {
  const sel = res.claudeSelection;
  if (sel && Date.now() - sel.ts < 15_000) {
    chrome.storage.local.remove('claudeSelection');
    const id = makeChat('selection', {
      selectionCtx: { text: sel.text, url: sel.url, title: sel.title },
      url: sel.url,
    });
    saveChats();
    openChat(id);
  }
});

// ─── Event wiring ─────────────────────────────────────────────────────────────
// Back to list
D.backBtn.addEventListener('click', () => { saveDraft(); saveChats(); showList(); });

// New blank chat
D.newChatBtn.addEventListener('click', () => {
  const id = makeChat('general');
  saveChats();
  openChat(id);
});

// Settings toggle (works from both views)
[D.settingsBtn].forEach(btn => btn?.addEventListener('click', () => D.settingsPanel.classList.toggle('hidden')));

D.saveSettingsBtn.addEventListener('click', () => {
  const key = D.apiKeyInput.value.trim();
  if (!key) { setStatus('Enter a valid API key.', 'error'); return; }
  apiKey = key;
  model  = D.modelSelect.value;
  chrome.storage.local.set({ apiKey, model }, () => {
    setStatus('Saved.', 'ok');
    D.settingsPanel.classList.add('hidden');
    updateSendBtn();
  });
});

// Capture page (chat view)
D.captureBtnChat.addEventListener('click', async () => {
  if (!activeId) return;
  setStatus('Capturing…');
  await captureForChat(activeId);
  saveChats();
});

// Delete chat
D.deleteChatBtn.addEventListener('click', () => {
  if (!activeId) return;
  if (confirm('Delete this chat?')) deleteChat(activeId);
});

// Export to Claude.ai
D.exportBtnChat.addEventListener('click', exportToClaudeAi);
D.openClaudeFooterBtn.addEventListener('click', exportToClaudeAi);

async function exportToClaudeAi() {
  const c = chat();
  if (!c || c.conversation.length === 0) { setStatus('Start a conversation first.', 'error'); return; }

  const lines = c.conversation.map(m => {
    const role = m.role === 'user' ? 'Human' : 'Assistant';
    const text = typeof m.content === 'string' ? m.content
      : (m.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
    return `**${role}:** ${text.trim()}`;
  }).filter(Boolean);

  const ctx = c.type === 'page' && c.pageCtx
    ? `*Context: "${c.pageCtx.title}" — ${c.pageCtx.url}*\n\n`
    : c.type === 'selection' && c.selectionCtx
    ? `*Context: highlighted text from ${c.selectionCtx.url}*\n\n`
    : '';

  await sSet({ claudeAiExport: { transcript: ctx + lines.join('\n\n'), ts: Date.now() } });
  chrome.tabs.create({ url: 'https://claude.ai/new' });
}

// Clear selection pill
D.clearSelectionBtn.addEventListener('click', () => {
  D.selectionPill.classList.add('hidden');
});

// Preview modal
D.previewBtn.addEventListener('click', () => {
  const c = chat();
  if (!c?.screenshot) return;
  D.previewImage.src = c.screenshot;
  D.previewModal.classList.remove('hidden');
});
D.closePreview.addEventListener('click', () => D.previewModal.classList.add('hidden'));
D.previewModal.addEventListener('click', e => { if (e.target === D.previewModal) D.previewModal.classList.add('hidden'); });

// Send
D.sendBtn.addEventListener('click', handleSend);
D.userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});
D.userInput.addEventListener('input', () => { autoResize(D.userInput); updateSendBtn(); });

// ─── Utilities ────────────────────────────────────────────────────────────────
function bg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res || {});
    });
  });
}

function updateSendBtn() {
  D.sendBtn.disabled = !D.userInput.value.trim() || isLoading || !apiKey || !activeId;
}

function setStatus(msg, type) {
  D.statusBar.textContent = msg;
  D.statusBar.style.color = type === 'error' ? 'var(--error)' : type === 'ok' ? '#16a34a' : 'var(--text-muted)';
}

function scrollBottom() { D.messages.scrollTop = D.messages.scrollHeight; }

function autoResize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; }

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function mdToHtml(t) {
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_,c) => `<pre><code>${c.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/\n/g,'<br>');
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000)    return 'just now';
  if (d < 3600000)  return Math.floor(d / 60000)   + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000)  + 'h ago';
  return               Math.floor(d / 86400000) + 'd ago';
}

// ─── Page navigation auto-open ────────────────────────────────────────────────
function saveDraft() {
  if (!activeId) return;
  chats[activeId].draft = D.userInput.value;
  D.userInput.value = '';
  autoResize(D.userInput);
}

function normalizeUrl(url) {
  try { const u = new URL(url); u.hash = ''; return u.toString().replace(/\/$/, ''); }
  catch { return url; }
}

function wordOverlap(text1, text2) {
  if (!text1 || !text2) return 0;
  const words = new Set((text1.toLowerCase().match(/\b\w{4,}\b/g) || []));
  return [...words].filter(w => text2.includes(w)).length;
}

async function pickBestChat(candidates) {
  try {
    const res = await bg({ type: 'GET_PAGE_CONTENT' });
    const pageText = (res.text || '').toLowerCase();
    if (pageText.length > 50) {
      let best = null, bestScore = -1;
      for (const c of candidates) {
        // Prefer selection chats whose selection text is still present on the page,
        // then page chats, using word overlap as the relevance signal.
        const ctxText = c.selectionCtx?.text || c.pageCtx?.text ||
          (typeof c.conversation[0]?.content === 'string' ? c.conversation[0].content : '');
        const score = wordOverlap(ctxText, pageText) + (c.updatedAt / 1e15);
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best) return best;
    }
  } catch {}
  // Fallback: most recently updated
  return candidates.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
}

async function handlePageNavigation(url, windowId) {
  saveDraft();

  // Verify this navigation is for the window this side panel belongs to
  if (windowId !== undefined) {
    const win = await new Promise(r => chrome.windows.getCurrent({}, r));
    if (win.id !== windowId) return;
  }

  const norm = normalizeUrl(url);

  // Stay put if the current chat already belongs to this URL
  if (activeId) {
    const c = chats[activeId];
    const cu = c?.pageCtx?.url || c?.selectionCtx?.url || c?.url;
    if (cu && normalizeUrl(cu) === norm) return;
  }

  const matches = Object.values(chats).filter(c => {
    const cu = c.pageCtx?.url || c.selectionCtx?.url || c.url;
    return cu && normalizeUrl(cu) === norm;
  });

  if (matches.length === 0) { showList(); return; }

  const best = matches.length === 1 ? matches[0] : await pickBestChat(matches);
  openChat(best.id);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadState();
