// Open the side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ─── Context menu ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-claude',
    title: 'Ask Claude about this',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'ask-claude' || !info.selectionText) return;
  chrome.storage.local.set({
    claudeSelection: {
      text:  info.selectionText,
      url:   tab.url   || '',
      title: tab.title || '',
      ts:    Date.now(),
    },
  });
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_SCREENSHOT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        sendResponse({ error: 'No active tab found' });
        return;
      }
      const tab = tabs[0];
      // captureVisibleTab must be called from background
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 90 }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataUrl, tabId: tab.id, tabUrl: tab.url, tabTitle: tab.title });
        }
      });
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'OPEN_WITH_SELECTION') {
    // Store selection for the sidebar to pick up
    chrome.storage.local.set({
      claudeSelection: {
        text:  message.text,
        url:   message.url,
        title: message.title,
        ts:    Date.now(),
      }
    });
    // Open the side panel on the sender's tab
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.sidePanel.open({ tabId: tabs[0].id });
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GET_PAGE_CONTENT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        sendResponse({ error: 'No active tab found' });
        return;
      }
      const tab = tabs[0];
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script may not be injected (e.g., chrome:// pages)
          sendResponse({ error: chrome.runtime.lastError.message, title: tab.title, url: tab.url });
        } else {
          sendResponse(response);
        }
      });
    });
    return true;
  }
});
