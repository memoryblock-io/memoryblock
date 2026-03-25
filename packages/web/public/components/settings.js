/**
 * Settings component — theme, plugins, session.
 * Plugin settings panels are auto-generated from plugin settings schemas.
 */

import { clearToken, getTheme, setTheme, api } from '../app.js';

export function renderSettings(container) {
    const currentTheme = getTheme();

    container.innerHTML = `
        <div class="settings-grid">
            <div class="settings-nav">
                <button class="settings-nav-item active" data-target="general">General</button>
                <button class="settings-nav-item" data-target="appearance">Appearance</button>
                <button class="settings-nav-item" data-target="plugins">Plugins</button>
                <button class="settings-nav-item" data-target="advanced">Advanced</button>
            </div>
            
            <div class="settings-content">
                <!-- General Settings -->
                <div class="settings-content-section active" id="setting-general">
                    <div class="settings-panel">
                        <h3>Workspace</h3>
                        <p class="desc">Manage your core memoryblock environment and data.</p>
                        <div class="setting-row">
                            <div>
                                <div class="setting-label">API Endpoint</div>
                                <div class="setting-desc">The local daemon server URL for memoryblock.</div>
                            </div>
                            <span class="dim" style="font-family: monospace;">${location.origin}</span>
                        </div>
                        <div class="setting-row">
                            <div>
                                <div class="setting-label">Channel Connectivity Alerts</div>
                                <div class="setting-desc">Broadcast "online" and "offline" status announcements to channels.</div>
                            </div>
                            <label class="plugin-toggle">
                                <input type="checkbox" id="setting-channel-alerts" disabled>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="setting-row">
                            <div>
                                <div class="setting-label">Session Status</div>
                                <div class="setting-desc">You are connected to the API correctly.</div>
                            </div>
                            <button class="btn-small danger" id="logout-btn">disconnect</button>
                        </div>
                    </div>
                </div>

                <!-- Appearance Settings -->
                <div class="settings-content-section" id="setting-appearance">
                    <div class="settings-panel">
                        <h3>Appearance</h3>
                        <p class="desc">Customize the look and feel of your memoryblock dashboard.</p>
                        <div class="setting-row">
                            <div>
                                <div class="setting-label">Theme</div>
                                <div class="setting-desc">Select between light and dark mode.</div>
                            </div>
                            <div class="theme-selector">
                                <button class="theme-option ${currentTheme === 'light' ? 'active' : ''}" data-theme="light">☀ light</button>
                                <button class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark">◑ dark</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Plugins Settings -->
                <div class="settings-content-section" id="setting-plugins">
                    <div class="settings-panel">
                        <h3>Plugins Configuration</h3>
                        <p class="desc">Manage settings and API keys for installed plugins.</p>
                        <div id="plugin-settings-list" class="plugin-settings-list">
                            <div class="loading">Loading plugins...</div>
                        </div>
                    </div>
                </div>

                <!-- Advanced Settings -->
                <div class="settings-content-section" id="setting-advanced">
                    <div class="settings-panel">
                        <h3>Advanced Setup</h3>
                        <p class="desc">Experimental features and dangerous actions.</p>
                        <div class="empty-state" style="padding: 20px;">
                            <span class="empty-icon" style="font-size: 1.5rem">🚧</span>
                            <p>More features coming soon.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Tab Navigation
    const navItems = container.querySelectorAll('.settings-nav-item');
    navItems.forEach(btn => {
        btn.addEventListener('click', () => {
            navItems.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            container.querySelectorAll('.settings-content-section').forEach(sec => {
                sec.classList.remove('active');
            });
            container.querySelector(`#setting-${btn.dataset.target}`).classList.add('active');
        });
    });

    // Theme toggle
    container.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            setTheme(theme);
            container.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        clearToken();
        window.dispatchEvent(new Event('auth:logout'));
    });

    // Load plugin settings
    loadPluginSettings();
    
    // Load general settings
    loadGeneralSettings();
}

async function loadGeneralSettings() {
    try {
        const data = await api('/api/config');
        if (!data || !data.config) return;
        
        const alertsToggle = document.getElementById('setting-channel-alerts');
        if (alertsToggle) {
            alertsToggle.checked = data.config.channelAlerts !== false;
            alertsToggle.disabled = false;
            
            alertsToggle.addEventListener('change', async () => {
                alertsToggle.disabled = true;
                try {
                    await api('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ channelAlerts: alertsToggle.checked })
                    });
                } catch {
                    alertsToggle.checked = !alertsToggle.checked; // revert on fail
                } finally {
                    alertsToggle.disabled = false;
                }
            });
        }
    } catch {
        // silently fail to load config
    }
}

async function loadPluginSettings() {
    const list = document.getElementById('plugin-settings-list');
    if (!list) return;

    try {
        const data = await api('/api/plugins');
        const plugins = data.plugins || [];

        if (plugins.length === 0) {
            list.innerHTML = '<div class="dim">No plugins installed.</div>';
            return;
        }

        list.innerHTML = plugins.map(pl => `
            <div class="plugin-settings-card" data-plugin="${pl.id}">
                <div class="plugin-settings-header" style="align-items: center; display: flex; justify-content: space-between;">
                    <div class="plugin-settings-info" style="flex: 1;">
                        <span class="plugin-settings-name">
                            ${pl.core ? '●' : '○'} ${pl.name}
                            ${pl.core ? '<span class="badge-core">core</span>' : ''}
                        </span>
                        <span class="plugin-settings-desc">${pl.description}</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <label class="plugin-toggle" title="${pl.core ? 'Core plugins cannot be disabled' : 'Toggle plugin installation'}">
                            <input type="checkbox" class="plugin-install-toggle" data-id="${pl.id}" ${pl.installed ? 'checked' : ''} ${pl.core ? 'disabled' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                        ${pl.settings && Object.keys(pl.settings).length > 0
                            ? `<button class="btn-small plugin-expand" data-id="${pl.id}">settings ▾</button>`
                            : ''}
                    </div>
                </div>
                <!-- Logs container for install/uninstall streaming -->
                <div class="plugin-logs" id="plugin-logs-${pl.id}" style="display:none; margin: 12px 0; background: var(--bg-deep); padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; color: #a3a3a3; max-height: 200px; overflow-y: auto; white-space: pre-wrap;"></div>
                <div class="plugin-settings-body" id="plugin-body-${pl.id}" style="display:none;">
                    ${renderPluginFields(pl)}
                </div>
            </div>
        `).join('');

        // Expand/collapse settings
        list.querySelectorAll('.plugin-expand').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = document.getElementById(`plugin-body-${btn.dataset.id}`);
                if (body) {
                    const open = body.style.display !== 'none';
                    body.style.display = open ? 'none' : 'block';
                    btn.textContent = open ? 'settings ▾' : 'settings ▴';
                }
            });
        });

        // Install/Uninstall toggle
        list.querySelectorAll('.plugin-install-toggle').forEach(toggle => {
            toggle.addEventListener('change', async (e) => {
                const isChecked = toggle.checked; // the target state
                const pluginId = toggle.dataset.id;
                const action = isChecked ? 'install' : 'uninstall';
                const logsDiv = document.getElementById(`plugin-logs-${pluginId}`);
                
                toggle.disabled = true; // prevent multi-click
                logsDiv.style.display = 'block';
                logsDiv.textContent = `Starting ${action} for ${pluginId}...\n`;

                try {
                    const res = await fetch(`${location.origin}/api/plugins/${pluginId}/${action}`, {
                        method: action === 'install' ? 'POST' : 'DELETE',
                        headers: { 'Authorization': `Bearer ${document.cookie || localStorage.getItem('mblk_token')}` } // api fetch overrides
                    });

                    if (!res.body) throw new Error('ReadableStream not supported');
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder('utf-8');

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        
                        // Parse the __RESULT__ marker if present
                        if (chunk.includes('__RESULT__')) {
                            const [logPart, resultStr] = chunk.split('__RESULT__');
                            logsDiv.textContent += logPart;
                            try {
                                const result = JSON.parse(resultStr);
                                if (!result.success) {
                                    logsDiv.textContent += `\nError: ${result.message}`;
                                    toggle.checked = !isChecked; // revert
                                } else {
                                    logsDiv.textContent += `\nSuccess: ${result.message}`;
                                }
                            } catch { }
                        } else {
                            logsDiv.textContent += chunk;
                        }
                        logsDiv.scrollTop = logsDiv.scrollHeight;
                    }
                } catch (err) {
                    logsDiv.textContent += `\nError: ${err.message}`;
                    toggle.checked = !isChecked; // revert
                } finally {
                    toggle.disabled = false;
                    setTimeout(() => { if (logsDiv) logsDiv.style.display = 'none'; }, 3000);
                }
            });
        });

        // Save handlers
        list.querySelectorAll('.plugin-save').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pluginId = btn.dataset.id;
                const body = document.getElementById(`plugin-body-${pluginId}`);
                if (!body) return;

                const values = {};
                body.querySelectorAll('[data-field]').forEach(input => {
                    if (input.type === 'checkbox') {
                        values[input.dataset.field] = input.checked;
                    } else if (input.type === 'number') {
                        values[input.dataset.field] = parseInt(input.value, 10);
                    } else {
                        values[input.dataset.field] = input.value;
                    }
                });

                try {
                    await api(`/api/plugins/${pluginId}/settings`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(values),
                    });
                    btn.textContent = '✓ saved';
                    setTimeout(() => btn.textContent = 'save', 1500);
                } catch {
                    btn.textContent = '✗ error';
                    setTimeout(() => btn.textContent = 'save', 1500);
                }
            });
        });
    } catch {
        list.innerHTML = '<div class="dim">Could not load plugins.</div>';
    }
}

function renderPluginFields(plugin) {
    if (!plugin.settings) return '';

    const fields = Object.entries(plugin.settings).map(([key, field]) => {
        const val = field.default ?? '';

        if (field.type === 'select') {
            const opts = (field.options || []).map(o =>
                `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`
            ).join('');
            return `
                <div class="setup-field">
                    <label>${field.label}</label>
                    <select data-field="${key}" class="settings-input">${opts}</select>
                </div>`;
        }

        if (field.type === 'toggle') {
            return `
                <div class="setup-field toggle-field">
                    <label>${field.label}</label>
                    <label class="plugin-toggle">
                        <input type="checkbox" data-field="${key}" ${val ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>`;
        }

        if (field.type === 'number') {
            return `
                <div class="setup-field">
                    <label>${field.label}</label>
                    <input type="number" data-field="${key}" value="${val}"
                           ${field.min !== undefined ? `min="${field.min}"` : ''}
                           ${field.max !== undefined ? `max="${field.max}"` : ''}
                           class="settings-input">
                </div>`;
        }

        return `
            <div class="setup-field">
                <label>${field.label}</label>
                <input type="${field.type === 'password' ? 'password' : 'text'}"
                       data-field="${key}" value="${val}"
                       placeholder="${field.placeholder || ''}"
                       class="settings-input">
            </div>`;
    }).join('');

    return `
        ${fields}
        <div class="plugin-settings-actions">
            <button class="btn-small plugin-save" data-id="${plugin.id}">save</button>
        </div>`;
}