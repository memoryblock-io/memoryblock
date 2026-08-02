/**
 * memoryblock web ui — Providers / Adapters / API Keys management.
 *
 * Rendered inside the settings page. Lets the user:
 *   - See the current state of every provider (configured / missing)
 *   - Set / change / clear API keys and base URLs
 *   - Save changes (PUT /api/auth/:provider)
 *   - Verify credentials (POST /v1/adapters/:provider/verify)
 *   - Change the global default adapter (PUT /api/config)
 *
 * Provider list and per-provider field schemas are dynamically fetched
 * from aiplug's `/v1/providers` endpoint via `./provider-schema.js`.
 * Adding a new provider requires only an aiplug-registry change.
 *
 * Secrets are NEVER sent to the UI in cleartext. The API masks them
 * (apiKey → "sk-•••••••ab"). To rotate, the user just types a new value.
 */

import { api, getToken } from '../app.js';
import {
    listProviders,
    configSchema,
    resetProviderCache,
} from './provider-schema.js';
import { escHtml, attrEsc } from '../escape.js';

/**
 * Render the Providers section into `container`.
 * `globalConfig` is the current GET /api/config response.
 */
export async function renderProviders(container, globalConfig) {
    const providers = await listProviders();
    container.innerHTML = `
        <div class="providers-section">
            <h3>Providers &amp; API Keys</h3>
            <p class="desc">Manage credentials for each LLM provider. Secret fields are masked; paste a new value to replace, leave blank to keep current.</p>

            <div class="default-adapter-row">
                <div>
                    <div class="setting-label">Default Adapter</div>
                    <div class="setting-desc">Used for new blocks and for the /v1 API when no provider is specified.</div>
                </div>
                <select id="default-adapter-select" class="form-input" style="max-width: 200px;">
                    ${providers.map(p => `<option value="${attrEsc(p.id)}">${escHtml(p.name)}</option>`).join('')}
                </select>
            </div>

            <div id="providers-list"></div>
        </div>
    `;
    const list = container.querySelector('#providers-list');
    for (const p of providers) {
        list.appendChild(await renderProviderCard(p));
    }
}

async function renderProviderCard(p) {
    const card = document.createElement('div');
    card.className = 'provider-card';
    const schema = await configSchema(p.id);
    const fields = schema.fields;
    card.innerHTML = `
        <div class="provider-header">
            <h4>${p.name}</h4>
            <span class="provider-hint">${p.hint || ''}</span>
        </div>
        <div class="provider-fields">
            ${fields.map(f => `
                <div class="form-row">
                    <label>${f.label}${f.required ? ' *' : ''}</label>
                    <input type="${f.secret ? 'password' : 'text'}"
                           class="form-input"
                           data-key="${f.key}"
                           placeholder="${f.placeholder || ''}">
                </div>
            `).join('')}
        </div>
        <div class="provider-actions">
            <button class="btn-ghost"   data-action="verify" data-provider="${p.id}">Verify</button>
            <button class="btn-primary" data-action="save"    data-provider="${p.id}">Save</button>
        </div>
    `;
    card.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const provider = btn.dataset.provider;
            const payload = {};
            card.querySelectorAll('input[data-key]').forEach((inp) => {
                if (inp.value) payload[inp.key] = inp.value;
            });
            if (action === 'save') {
                await api(`/api/auth/${provider}`, { method: 'PUT', body: payload });
                btn.textContent = 'Saved';
                setTimeout(() => { btn.textContent = 'Save'; }, 1500);
            } else if (action === 'verify') {
                btn.textContent = 'Verifying…';
                try {
                    const r = await api(`/v1/adapters/${provider}/verify`, { method: 'POST', body: payload });
                    btn.textContent = r.ok ? 'OK' : 'Failed';
                } catch (e) {
                    btn.textContent = 'Failed';
                }
                setTimeout(() => { btn.textContent = 'Verify'; }, 2000);
            }
        });
    });
    return card;
}

export { listProviders, resetProviderCache };
