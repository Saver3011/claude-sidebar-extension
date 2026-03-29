# Claude Sidebar — Chrome Extension

A Chrome extension that adds a Claude AI chat panel to any webpage. Ask questions about the page you're reading, highlight text to start a focused conversation, and keep multiple chats organised by context.

![Claude Sidebar](icons/icon128.png)

---

## Features

- **Page chats** — captures a screenshot + full text of the current page as context
- **Selection chats** — highlight any text, right-click → *Ask Claude about this*, and start a conversation scoped to just that excerpt (no screenshot)
- **Multiple chats** — full chat list with per-chat history that persists across sessions
- **Works everywhere** — regular websites, Google Docs, embedded iframes
- **Export to Claude.ai** — continue any conversation in your Claude.ai account with one click

---

## Installation

1. Clone or download this repo
   ```bash
   git clone https://github.com/Saver3011/claude-sidebar-extension.git
   ```
2. Generate icons (one-time, requires Node.js)
   ```bash
   node generate-icons.js
   ```
3. Open Chrome and go to `chrome://extensions/`
4. Enable **Developer mode** (toggle, top-right)
5. Click **Load unpacked** and select the project folder

---

## Setup

1. Click the extension icon in the toolbar to open the sidebar
2. Click the **⚙ Settings** button and paste your [Anthropic API key](https://console.anthropic.com/settings/keys)
3. Choose your preferred model and save

Your API key is stored locally in Chrome and is only ever sent to `api.anthropic.com`.

---

## Usage

### Ask about a page
Open the sidebar on any webpage and type a question. On your first message, Claude automatically captures a screenshot and the full page text.

### Ask about highlighted text
1. Select any text on a page
2. Right-click → **Ask Claude about this**
3. The sidebar opens a new *Selection* chat scoped to that text — no screenshot taken

### Manage chats
- The **home screen** lists all your chats (Page / Selection / General) sorted by recency
- Click **+** in the header to start a blank chat
- Click **←** to return to the list from any chat
- Click **×** on a card to delete a chat

### Continue in Claude.ai
After any reply, click **Continue in Claude.ai** to export the full conversation transcript into a new Claude.ai session.

---

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | Extension config (MV3) |
| `background.js` | Service worker — screenshot capture, context menu, sidebar open |
| `content.js` | Injected into every page — selection tooltip + page text extraction |
| `claude-ai-inject.js` | Injected into claude.ai — pastes exported transcripts into the editor |
| `sidepanel.html` | Sidebar UI markup |
| `sidepanel.css` | Sidebar styles |
| `sidepanel.js` | Sidebar logic — chat management, Claude API calls |
| `generate-icons.js` | Node script to generate PNG icons (run once) |

---

## Requirements

- Chrome 116+ (Side Panel API)
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- Node.js (only to run `generate-icons.js` once)

---

## License

MIT
