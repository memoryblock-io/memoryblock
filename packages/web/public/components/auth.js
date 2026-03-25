/**
 * Auth component — token input card and session management.
 */

import { api, getToken, setToken, clearToken } from '../app.js';

export function renderAuth(container) {
    container.innerHTML = `
        <div class="view active" id="auth-view">
            <div class="auth-wrapper">
                <div class="auth-card">
                    <div class="brand">⬡ memoryblock</div>
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