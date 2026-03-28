/**
 * Auth component — token input card and session management.
 */

import { api, getToken, setToken, clearToken } from '../app.js';

export function renderAuth(container) {
    container.innerHTML = `
        <div class="view active" id="auth-view">
            <div class="auth-wrapper">
                <div class="auth-card">
                    <div class="brand"><span class="brand-logo"><svg width="24" height="26" viewBox="0 0 24 26" fill="none"><defs><linearGradient id="hexGrad" x1="0" y1="0" x2="24" y2="26"><stop offset="0%" class="hex-stop1" style="stop-color:#7C3AED"><animate attributeName="stop-color" values="#7C3AED;#AF52DE;#b344ff;#ff4a5a;#7C3AED" dur="4s" repeatCount="indefinite"/></stop><stop offset="50%" class="hex-stop2" style="stop-color:#AF52DE"><animate attributeName="stop-color" values="#AF52DE;#b344ff;#ff4a5a;#7C3AED;#AF52DE" dur="4s" repeatCount="indefinite"/></stop><stop offset="100%" class="hex-stop3" style="stop-color:#b344ff"><animate attributeName="stop-color" values="#b344ff;#ff4a5a;#7C3AED;#AF52DE;#b344ff" dur="4s" repeatCount="indefinite"/></stop></linearGradient></defs><path d="M12 1L22 7v12l-10 6L2 19V7l10-6z" stroke="url(#hexGrad)" stroke-width="2" fill="none"/></svg></span> memoryblock</div>
                    <p class="auth-hint">paste your auth token to continue</p>
                    <input type="text" class="token-input" id="token-input" placeholder="mblk_..." autocomplete="off" spellcheck="false">
                    <button class="btn-primary" id="auth-btn">connect</button>
                    <p class="error-text" id="auth-error"></p>
                </div>
            </div>
        </div>
    `;

    const input = document.getElementById('token-input');
    const errorEl = document.getElementById('auth-error');

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') authenticate();
    });

    document.getElementById('auth-btn').addEventListener('click', authenticate);

    async function authenticate() {
        const token = input.value.trim();
        if (!token) { errorEl.textContent = 'enter a token'; return; }

        try {
            const res = await fetch(`${location.origin}/api/auth/status`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();

            if (data.authenticated) {
                setToken(token);
                errorEl.textContent = '';
                window.dispatchEvent(new Event('auth:success'));
            } else {
                errorEl.textContent = 'invalid token';
                input.focus();
            }
        } catch {
            errorEl.textContent = 'cannot reach api server';
        }
    }

    input.focus();
}

export async function tryAutoAuth() {
    const token = getToken();
    if (!token) return false;

    try {
        const res = await fetch(`${location.origin}/api/auth/status`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        return data.authenticated;
    } catch {
        return false;
    }
}