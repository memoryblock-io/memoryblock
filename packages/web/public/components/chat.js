import { api, connectWs, getToken } from '../app.js';

/**
 * Lightweight markdown-to-HTML renderer.
 * Handles: bold, italic, code blocks, inline code, headers, lists, links, line breaks.
 */
function renderMarkdown(text) {
    if (!text) return '';
    
    // Escape HTML first
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Fenced code blocks: ```lang\ncode\n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
        return `<pre class="code-block"><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`;
    });

    // Inline code: `code`
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Headers: ### heading
    html = html.replace(/^### (.+)$/gm, '<strong class="md-h3">$1</strong>');
    html = html.replace(/^## (.+)$/gm, '<strong class="md-h2">$1</strong>');
    html = html.replace(/^# (.+)$/gm, '<strong class="md-h1">$1</strong>');

    // Bold: **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic: _text_ or *text*
    html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
    html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');

    // Links: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Unordered lists: - item or * item (at start of line)
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Ordered lists: 1. item
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Horizontal rules
    html = html.replace(/^(?:---|\*\*\*|___)$/gm, '<hr>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    html = `<p>${html}</p>`;
    html = html.replace(/<p><\/p>/g, '');

    return html;
}

let chatWs = null;
let currentSession = 'web';

export async function renderChatView(container, blockName) {
    // Fetch block details to get monitor name + emoji
    let monitorLabel = blockName;
    let monitorEmoji = '';
    try {
        const data = await api(`/api/blocks/${blockName}`, { method: 'GET' });
        if (data.config) {
            monitorLabel = data.config.monitorName || blockName;
            monitorEmoji = data.config.monitorEmoji || '';
        }
    } catch { /* fallback to block name */ }

    const displayName = monitorEmoji ? `${monitorEmoji} ${monitorLabel}` : monitorLabel;

    // Create a full-screen overlay that sits on top of everything
    const overlay = document.createElement('div');
    overlay.id = 'chat-overlay';
    overlay.className = 'chat-overlay';
    overlay.innerHTML = `
        <div class="chat-overlay-inner">
            <div class="chat-container">
                <div class="chat-sidebar" id="chat-sidebar">
                    <div class="sidebar-header">
                        <h3>Sessions</h3>
                        <button class="sidebar-toggle" id="sidebar-toggle" title="Collapse sidebar">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                        </button>
                    </div>
                    <div class="session-list" id="chat-sessions">
                        <div class="session-tab active" data-session="web">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                            Web Channel
                        </div>
                        <div class="session-tab" data-session="cli">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                            CLI Channel
                        </div>
                        <div class="session-tab" data-session="telegram">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>
                            Telegram
                        </div>
                    </div>
                </div>

                <button class="sidebar-expand-btn hidden" id="sidebar-expand-btn" title="Show sidebar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </button>
                
                <div class="chat-main">
                    <div class="chat-header">
                        <div class="chat-header-left">
                            <button class="chat-close-btn" id="chat-close-btn" title="Close chat">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                            </button>
                            <h2>${escapeHtml(displayName)}</h2>
                        </div>
                        <span class="status-indicator" id="chat-status">
                            <span class="status-dot sleeping"></span>
                            <span id="chat-status-text">Checking...</span>
                        </span>
                    </div>
                    
                    <div class="chat-messages" id="chat-messages">
                        <div class="chat-msg system">
                            <div class="msg-content">Joined Web Channel for ${escapeHtml(displayName)}.</div>
                        </div>
                    </div>
                    
                    <div class="chat-input-area">
                        <textarea id="chat-input" placeholder="Type a message... (Enter to send, Shift+Enter for new line)" rows="1"></textarea>
                        <button id="chat-send-btn" class="action-btn primary"><span class="action-icon">↑</span></button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    // Trigger transition
    requestAnimationFrame(() => overlay.classList.add('visible'));

    // Close button — remove overlay and go back
    function closeChat() {
        if (chatWs) { chatWs.close(); chatWs = null; }
        overlay.classList.remove('visible');
        setTimeout(() => {
            overlay.remove();
        }, 300);
    }

    document.getElementById('chat-close-btn').addEventListener('click', closeChat);

    // ESC key to close
    const escHandler = (e) => { if (e.key === 'Escape') closeChat(); };
    document.addEventListener('keydown', escHandler);

    // Sidebar toggle
    const sidebar = document.getElementById('chat-sidebar');
    const expandBtn = document.getElementById('sidebar-expand-btn');
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        sidebar.classList.add('collapsed');
        expandBtn.classList.remove('hidden');
    });
    expandBtn.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
        expandBtn.classList.add('hidden');
    });

    // Session tab switching
    const messagesDiv = document.getElementById('chat-messages');

    document.querySelectorAll('.session-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const session = tab.dataset.session;
            if (session === currentSession) return;
            
            currentSession = session;
            document.querySelectorAll('.session-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const channelLabels = { web: 'Web Channel', cli: 'CLI Channel', telegram: 'Telegram' };
            messagesDiv.innerHTML = '';
            appendMessage('system', `Viewing ${channelLabels[session] || session} logs for ${escapeHtml(displayName)}.`);
            loadChatHistory(session);
        });
    });

    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');

    function appendMessage(role, content) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${role}`;
        
        if (role === 'assistant' || role === 'system') {
            msgDiv.innerHTML = `<div class="msg-content">${renderMarkdown(content)}</div>`;
        } else if (role === 'error') {
            msgDiv.innerHTML = `<div class="msg-content">${escapeHtml(content)}</div>`;
        } else {
            msgDiv.innerHTML = `<div class="msg-content">${escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
        }
        
        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    async function loadChatHistory(channel) {
        try {
            const data = await api(`/api/blocks/${blockName}/chat?channel=${channel || 'web'}`, { method: 'GET' });
            // Don't clear — caller clears if needed
            if (data.messages && data.messages.length > 0) {
                for (const m of data.messages) {
                    appendMessage(m.role, m.content);
                }
            }
        } catch {
            // failed to load history
        }
    }

    async function updateConnectionStatus() {
        try {
            const data = await api(`/api/blocks/${blockName}`, { method: 'GET' });
            const statusDot = document.querySelector('#chat-status .status-dot');
            const statusText = document.getElementById('chat-status-text');
            if (!statusDot || !statusText) return;

            const pulseStatus = data.pulse?.status || 'SLEEPING';
            
            if (pulseStatus === 'ACTIVE') {
                statusDot.className = 'status-dot active';
                statusText.textContent = 'Connected';
            } else if (pulseStatus === 'ERROR') {
                statusDot.className = 'status-dot error';
                statusText.textContent = 'Error';
            } else {
                statusDot.className = 'status-dot sleeping';
                statusText.textContent = 'Sleeping';
            }
        } catch { /* ignore */ }
    }

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        chatInput.value = '';
        chatInput.style.height = 'auto';
        appendMessage('user', text);

        // Wake the block if asleep
        try {
            await api(`/api/blocks/${blockName}/start`, { method: 'POST' });
        } catch { /* already active */ }

        // Show connecting status
        const statusDot = document.querySelector('#chat-status .status-dot');
        const statusText = document.getElementById('chat-status-text');
        if (statusDot && statusText) {
            statusDot.className = 'status-dot connecting';
            statusText.textContent = 'Connecting...';
        }

        try {
            const res = await api(`/api/blocks/${blockName}/chat`, {
                method: 'POST',
                body: JSON.stringify({ message: text })
            });
            if (res.error) {
                appendMessage('error', res.error);
            } else if (res.note) {
                appendMessage('system', res.note);
            }
        } catch (err) {
            appendMessage('error', 'Error: ' + err.message);
        }
    }

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    sendBtn.addEventListener('click', sendMessage);

    if (chatWs) chatWs.close();
    chatWs = connectWs(blockName, () => {
        loadChatHistory(currentSession);
        updateConnectionStatus();
    });

    currentSession = 'web';
    loadChatHistory('web');
    updateConnectionStatus();
    setTimeout(() => chatInput.focus(), 300);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}
