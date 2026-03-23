/**
 * memoryblock web ui — app router & shared utilities.
 * ES module entry point — imports components.
 */

import { renderAuth, tryAutoAuth } from './components/auth.js';
import { renderBlocksList, renderBlockDetail } from './components/blocks.js';
import { renderSettings } from './components/settings.js';
import { renderCreateBlock } from './components/create-block.js';
import { renderArchive } from './components/archive.js';
import { renderSetup } from './components/setup.js';
import { renderChatView } from './components/chat.js';

const API_BASE = location.origin;

// ===== Token Management =====

export function getToken() { return localStorage.getItem('mblk_token') || ''; }
export function setToken(t) { localStorage.setItem('mblk_token', t); }
export function clearToken() { localStorage.removeItem('mblk_token'); }

// ===== Theme Management =====

export function getTheme() { return localStorage.getItem('mblk_theme') || 'dark'; }
export function setTheme(t) {
    localStorage.setItem('mblk_theme', t);
    document.documentElement.setAttribute('data-theme', t);
}

// ===== API Helper =====

export async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { 
            'Authorization': `Bearer ${getToken()}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        },
    });
    if (res.status === 401) {
        clearToken();
        window.dispatchEvent(new Event('auth:logout'));
        throw new Error('unauthorized');
    }
    return res.json();
}

// ===== WebSocket Helper =====

export function connectWs(blockName, onRefresh) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/api/ws?token=${getToken()}`);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe', block: blockName }));
    };
    
    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'refresh' && onRefresh) onRefresh();
        } catch {}
    };
    
    return ws;
}

// ===== Layout Templates =====

function mainLayout() {
    return `
        <div class="view active" id="main-view">
            <header>
                <div class="header-left">
                    <div class="brand-small">⬡ memoryblock</div>
                    <nav>
                        <button class="nav-btn active" data-tab="blocks">blocks</button>
                        <button class="nav-btn" data-tab="archive">archive</button>
                        <button class="nav-btn" data-tab="settings">settings</button>
                    </nav>
                </div>
                <button class="theme-toggle" id="quick-theme">${getTheme() === 'dark' ? '☀' : '◑'}</button>
            </header>
            <main id="main-content"></main>
        </div>
    `;
}

// ===== Router =====

let currentTab = 'blocks';

async function showMain() {
    // Check if any blocks exist — if not, show setup wizard
    try {
        const data = await api('/api/blocks');
        if (!data.blocks || data.blocks.length === 0) {
            const setupDone = localStorage.getItem('mblk_setup_done');
            if (!setupDone) {
                const app = document.getElementById('app');
                renderSetup(app, {
                    api,
                    onComplete: () => {
                        localStorage.setItem('mblk_setup_done', '1');
                        showMain();
                    },
                });
                return;
            }
        }
    } catch { }

    const app = document.getElementById('app');
    app.innerHTML = mainLayout();

    const content = document.getElementById('main-content');

    // Tab navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentTab = btn.dataset.tab;
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTab(content, currentTab);
        });
    });

    // Quick theme toggle
    document.getElementById('quick-theme').addEventListener('click', () => {
        const next = getTheme() === 'dark' ? 'light' : 'dark';
        setTheme(next);
        document.getElementById('quick-theme').textContent = next === 'dark' ? '☀' : '◑';
    });

    renderTab(content, currentTab);
}

function renderTab(content, tab) {
    if (tab === 'blocks') renderBlocksList(content);
    else if (tab === 'archive') renderArchive(content, { apiBase: API_BASE, token: getToken() });
    else if (tab === 'settings') renderSettings(content);
}

function showAuth() {
    const app = document.getElementById('app');
    renderAuth(app);
}

// ===== Event Listeners =====

window.addEventListener('auth:success', () => showMain());
window.addEventListener('auth:logout', () => showAuth());
window.addEventListener('navigate', (e) => {
    const { view, block } = e.detail;
    const content = document.getElementById('main-content');
    if (view === 'detail' && block) {
        renderBlockDetail(content, block);
    } else if (view === 'chat' && block) {
        renderChatView(content, block);
    } else if (view === 'blocks') {
        renderBlocksList(content);
    }
});

// ===== Hash Router =====

function handleHash() {
    const hash = window.location.hash;
    const content = document.getElementById('main-content');
    if (!content) return;

    if (hash === '#/create') {
        renderCreateBlock(content, {
            apiBase: API_BASE,
            token: getToken(),
            onCreated: () => {},
        });
    } else if (hash.startsWith('#/block/')) {
        const blockName = hash.replace('#/block/', '');
        renderBlockDetail(content, blockName);
    } else if (hash.startsWith('#/chat/')) {
        const blockName = hash.replace('#/chat/', '');
        renderChatView(content, blockName);
    } else if (hash === '#/archive') {
        currentTab = 'archive';
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tab="archive"]')?.classList.add('active');
        renderArchive(content, { apiBase: API_BASE, token: getToken() });
    }
}

window.addEventListener('hashchange', handleHash);

// ===== Init =====

(async () => {
    setTheme(getTheme());
    if (await tryAutoAuth()) {
        showMain();
        handleHash();
    } else {
        showAuth();
    }
})();
