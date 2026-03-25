/**
 * Blocks component — block list and detail views.
 */

import { api, connectWs } from '../app.js';
import { showToast } from './create-block.js';

let activeWs = null;

export function renderBlocksList(container) {
    if (activeWs) { activeWs.close(); activeWs = null; }
    container.innerHTML = '<div class="loading">loading blocks...</div>';

    loadBlocks(container);
}

async function loadBlocks(container) {
    try {
        const data = await api('/api/blocks');

        if (!data.blocks || data.blocks.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">⬡</span>
                    <p>No blocks yet.</p>
                    <button class="action-btn primary" id="empty-create-btn">Create Your First Block</button>
                </div>
            `;
            document.getElementById('empty-create-btn').addEventListener('click', () => {
                window.location.hash = '#/create';
            });
            return;
        }

        container.innerHTML = `
            <div class="blocks-header">
                <button class="action-btn primary" id="create-block-btn">+ Create Block</button>
            </div>
            <div class="blocks-grid">
            ${data.blocks.map(block => {
                const status = block.pulse?.status?.toLowerCase() || 'sleeping';
                const cost = block.costs?.totalCost || 0;
                const emoji = block.monitorEmoji || '⬡';
                const monitorName = block.monitorName || 'default monitor';
                const name = block.name;
                const desc = block.description || '';

                return `
                    <div class="block-card" data-block="${name}">
                        <div class="block-info">
                            <span class="block-emoji">${emoji}</span>
                            <div class="block-name">${name}</div>
                            ${desc ? `<div class="block-desc">${desc}</div>` : ''}
                            <div class="block-details-tags">
                                <span class="tag"><span class="tag-icon">${emoji}</span> ${monitorName}</span>
                                <span class="tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tag-svg" style="margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${block.adapter?.provider || 'unknown'}</span>
                                ${(block.channel || 'cli').split(',').map(c => `<span class="tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tag-svg" style="margin-right:4px;"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg> ${c.trim()}</span>`).join('')}
                            </div>
                        </div>
                        <div class="block-meta">
                            <div class="status-indicator"><span class="status-dot ${status}"></span>${status}</div>
                            <div style="font-size:0.75rem; opacity:0.6">${formatTokens((block.costs?.totalInput || 0) + (block.costs?.totalOutput || 0))} tokens</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>`;

        // Create button
        document.getElementById('create-block-btn').addEventListener('click', () => {
            window.location.hash = '#/create';
        });

        // Attach click handlers
        container.querySelectorAll('.block-card').forEach(card => {
            card.addEventListener('click', () => {
                const blockName = card.dataset.block;
                window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'detail', block: blockName } }));
            });
        });
    } catch {
        container.innerHTML = '<div class="loading">error loading blocks</div>';
    }
}

export async function renderBlockDetail(container, blockName) {
    container.innerHTML = '<div class="loading">loading...</div>';

    try {
        const data = await api(`/api/blocks/${blockName}`);
        const config = data.config;
        const costs = data.costs || {};
        const pulse = data.pulse || {};
        const memory = data.memory || '(no memory yet)';
        const monitor = data.monitor || '(no monitor log yet)';
        const model = config.adapter?.model?.split('.').pop()?.replace(/-v\d.*$/, '') || 'unknown';

        container.innerHTML = `
            <div class="detail-layout">
                <div class="detail-main">
                    <div class="detail-top-nav">
                        <button class="back-btn" id="back-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px; vertical-align:text-bottom;"><path d="m15 18-6-6 6-6"/></svg>
                            back to blocks
                        </button>
                    </div>
                    
                    <div class="detail-header-block">
                        <div class="detail-header-info">
                            <div class="detail-title">${config.name}</div>
                            ${config.description ? `<div class="detail-subtitle">${config.description}</div>` : ''}
                            
                            <div class="block-details-tags" style="margin-top: 14px;">
                                <span class="tag"><span class="tag-icon">${config.monitorEmoji || '⬡'}</span> ${config.monitorName || 'default monitor'}</span>
                                <span class="tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tag-svg" style="margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${config.adapter?.provider || 'unknown'} ${model}</span>
                                ${(config.channel?.type || 'cli').split(',').map(c => `<span class="tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tag-svg" style="margin-right:4px;"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg> ${c.trim()}</span>`).join('')}
                            </div>
                        </div>

                        <div class="action-bar">
                            <button class="action-btn" id="chat-btn" title="Open Web Chat"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-svg" style="margin-right:6px;"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg> Chat</button>
                            <button class="action-btn primary" id="start-btn" title="Start monitor"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-svg" style="margin-right:6px;"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start</button>
                            <button class="action-btn" id="stop-btn" title="Stop monitor"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-svg" style="margin-right:6px;"><rect width="18" height="18" x="3" y="3" rx="2"/></svg> Stop</button>
                        </div>
                    </div>
                    
                    <div class="settings-tabs">
                        <button class="settings-tab-btn active" data-tab="overview">Overview</button>
                        <button class="settings-tab-btn" data-tab="settings">Settings</button>
                    </div>

                    <div id="tab-overview">
                        <div class="detail-section">
                            <h4>memory.md</h4>
                            <div class="memory-content" id="val-memory">${escapeHtml(memory.slice(0, 1500))}</div>
                        </div>

                        <div class="detail-section">
                            <h4>monitor.md (agent logic tree)</h4>
                            <div class="memory-content" id="val-monitor">${escapeHtml(monitor.slice(0, 1500))}</div>
                        </div>

                        <div class="detail-section">
                            <h4>active goals</h4>
                            <div class="memory-content" style="background:transparent; border:none; padding:0;">${(config.goals || []).map(g => '• ' + g).join('<br>') || '(none set)'}</div>
                        </div>
                    </div>

                    <div id="tab-settings" style="display:none;">
                        <div class="settings-panel">
                            <h3>General Options</h3>
                            <div class="form-group" style="margin-bottom:16px;">
                                <label>Description</label>
                                <input type="text" id="cfg-desc" class="form-input" value="${escapeHtml(config.description || '')}" placeholder="What does this block do?" />
                            </div>
                            <div class="form-group" style="margin-bottom:16px;">
                                <label>System Prompt (Persona)</label>
                                <textarea id="cfg-prompt" class="form-input" style="min-height:90px; resize:vertical;" placeholder="You are a helpful assistant...">${escapeHtml(config.systemPrompt || '')}</textarea>
                            </div>
                        </div>

                        <div class="settings-panel">
                            <h3>Monitor Details</h3>
                            <div class="stat-grid">
                                <div class="form-group">
                                    <label>Display Name</label>
                                    <input type="text" id="cfg-mon-name" class="form-input" value="${escapeHtml(config.monitorName || '')}" placeholder="e.g. Chief Editor" />
                                </div>
                                <div class="form-group">
                                    <label>Monitor Emoji</label>
                                    <input type="text" id="cfg-mon-emoji" class="form-input" value="${escapeHtml(config.monitorEmoji || '')}" maxlength="4" placeholder="⬡" />
                                </div>
                            </div>
                        </div>

                        <div class="settings-panel">
                            <h3>Model & Adapter</h3>
                            <div class="stat-grid">
                                <div class="form-group">
                                    <label>Provider Runtime</label>
                                    <select id="cfg-provider" class="form-input">
                                        <option value="bedrock" ${config.adapter?.provider === 'bedrock' ? 'selected' : ''}>AWS Bedrock</option>
                                        <option value="openai" ${config.adapter?.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                                        <option value="anthropic" ${config.adapter?.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
                                        <option value="gemini" ${config.adapter?.provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                                        <option value="ollama" ${config.adapter?.provider === 'ollama' ? 'selected' : ''}>Ollama</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Model String</label>
                                    <input type="text" id="cfg-model" class="form-input" value="${escapeHtml(config.adapter?.model || '')}" placeholder="e.g. gpt-4o" />
                                </div>
                            </div>
                        </div>

                        <div class="settings-panel">
                            <h3>Performance & Memory</h3>
                            <div class="stat-grid">
                                <div class="form-group">
                                    <label>Max Context Tokens</label>
                                    <input type="number" id="cfg-mem-tokens" class="form-input" value="${config.memory?.maxContextTokens || 120000}" />
                                </div>
                                <div class="form-group">
                                    <label>Wake Interval (seconds)</label>
                                    <input type="number" id="cfg-pulse-interval" class="form-input" value="${config.pulse?.intervalSeconds || 60}" />
                                </div>
                            </div>
                        </div>

                        <div class="settings-panel">
                            <h3>Permissions & Security <span style="font-size:0.7rem; font-weight:normal; color:#f44;">(Requires restart)</span></h3>
                            <div class="stat-grid">
                                <div class="form-group">
                                    <label>Allow Shell Execution</label>
                                    <select id="cfg-perm-shell" class="form-input">
                                        <option value="false" ${!config.permissions?.allowShell ? 'selected' : ''}>Disabled (Secure)</option>
                                        <option value="true" ${config.permissions?.allowShell ? 'selected' : ''}>Enabled (Danger)</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Allow Network Access</label>
                                    <select id="cfg-perm-network" class="form-input">
                                        <option value="true" ${config.permissions?.allowNetwork ? 'selected' : ''}>Enabled</option>
                                        <option value="false" ${!config.permissions?.allowNetwork ? 'selected' : ''}>Disabled</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Max Execution Timeout (ms)</label>
                                    <input type="number" id="cfg-perm-timeout" class="form-input" value="${config.permissions?.maxTimeout || 120000}" />
                                </div>
                                <div class="form-group">
                                    <label>Plugin Sandbox (Isolated)</label>
                                    <select id="cfg-tool-sandbox" class="form-input">
                                        <option value="true" ${config.tools?.sandbox ? 'selected' : ''}>Enabled</option>
                                        <option value="false" ${!config.tools?.sandbox ? 'selected' : ''}>Disabled</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="form-actions" style="margin-top: 16px; display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; gap: 8px;">
                                <button class="action-btn" id="reset-btn" title="Reset state"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-svg" style="margin-right:6px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Reset</button>
                                <button class="action-btn danger" id="archive-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-svg" style="margin-right:6px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg> Archive</button>
                            </div>
                            <button id="save-config-btn" class="action-btn primary">Save Config Changes</button>
                        </div>
                    </div>

                </div>

                <div class="detail-sidebar">
                    <div class="detail-section" style="margin-bottom:0; height: 100%;">
                        <h4>costs & tokens</h4>
                        <div class="stat-grid" style="grid-template-columns: 1fr;">
                            <div class="stat">
                                <div class="stat-value" id="val-status" style="font-size:1rem; color:var(--text);">${pulse.status || 'SLEEPING'}</div>
                                <div class="stat-label">status</div>
                            </div>
                            <div class="stat">
                                <div class="stat-value" id="val-in">${formatTokens(costs.totalInput || 0)}</div>
                                <div class="stat-label">input tokens</div>
                            </div>
                            <div class="stat">
                                <div class="stat-value" id="val-out">${formatTokens(costs.totalOutput || 0)}</div>
                                <div class="stat-label">output tokens</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Tab switching
        const tabs = container.querySelectorAll('.settings-tab-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                if (tab.dataset.tab === 'overview') {
                    container.querySelector('#tab-overview').style.display = 'block';
                    container.querySelector('#tab-settings').style.display = 'none';
                } else {
                    container.querySelector('#tab-overview').style.display = 'none';
                    container.querySelector('#tab-settings').style.display = 'block';
                }
            });
        });

        // Connect WebSocket for live updates
        if (activeWs) activeWs.close();
        activeWs = connectWs(blockName, async () => {
            try {
                const live = await api(`/api/blocks/${blockName}`);
                document.getElementById('val-in').textContent = formatTokens(live.costs?.totalInput || 0);
                document.getElementById('val-out').textContent = formatTokens(live.costs?.totalOutput || 0);
                document.getElementById('val-status').textContent = live.pulse?.status || 'SLEEPING';
                if (document.getElementById('val-memory')) document.getElementById('val-memory').innerHTML = escapeHtml(live.memory?.slice(0, 1500) || '');
                if (document.getElementById('val-monitor')) document.getElementById('val-monitor').innerHTML = escapeHtml(live.monitor?.slice(0, 1500) || '');
            } catch {}
        });

        document.getElementById('back-btn').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'blocks' } }));
        });

        document.getElementById('archive-btn').addEventListener('click', async () => {
            if (confirm(`Archive ${blockName}? It will be stored safely but removed from active rotation.`)) {
                document.getElementById('archive-btn').textContent = 'archiving...';
                document.getElementById('archive-btn').disabled = true;
                try {
                    await api(`/api/blocks/${blockName}`, { method: 'DELETE' });
                    showToast(`${blockName} archived.`);
                    window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'blocks' } }));
                } catch (e) {
                    showToast('Failed to archive: ' + e.message);
                    document.getElementById('archive-btn').textContent = 'Archive';
                    document.getElementById('archive-btn').disabled = false;
                }
            }
        });

        // Chat View Open
        document.getElementById('chat-btn').addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'chat', block: blockName } }));
        });

        // Start button
        document.getElementById('start-btn').addEventListener('click', async () => {
            const btn = document.getElementById('start-btn');
            btn.disabled = true;
            btn.textContent = 'Starting...';
            try {
                await api(`/api/blocks/${blockName}/start`, { method: 'POST' });
                showToast(`${blockName} started.`);
                btn.textContent = '▶ Start';
                btn.disabled = false;
            } catch (e) {
                showToast('Start failed: ' + e.message);
                btn.textContent = '▶ Start';
                btn.disabled = false;
            }
        });

        // Stop button
        document.getElementById('stop-btn').addEventListener('click', async () => {
            const btn = document.getElementById('stop-btn');
            btn.disabled = true;
            btn.textContent = 'Stopping...';
            try {
                await api(`/api/blocks/${blockName}/stop`, { method: 'POST' });
                showToast(`${blockName} stopped.`);
                btn.textContent = '⏹ Stop';
                btn.disabled = false;
            } catch (e) {
                showToast('Stop failed: ' + e.message);
                btn.textContent = '⏹ Stop';
                btn.disabled = false;
            }
        });

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', async () => {
            if (!confirm(`Reset ${blockName}? This clears memory, costs, and session data.`)) return;
            const btn = document.getElementById('reset-btn');
            btn.disabled = true;
            btn.textContent = 'Resetting...';
            try {
                await api(`/api/blocks/${blockName}/reset`, { method: 'POST' });
                showToast(`${blockName} reset.`);
                btn.textContent = '↺ Reset';
                btn.disabled = false;
                // Refresh the detail view
                renderBlockDetail(container, blockName);
            } catch (e) {
                showToast('Reset failed: ' + e.message);
                btn.textContent = '↺ Reset';
                btn.disabled = false;
            }
        });
        // Save Settings button
        document.getElementById('save-config-btn').addEventListener('click', async () => {
            const btn = document.getElementById('save-config-btn');
            btn.disabled = true;
            btn.textContent = 'Saving...';
            
            const updates = {
                description: document.getElementById('cfg-desc').value,
                systemPrompt: document.getElementById('cfg-prompt').value,
                monitorName: document.getElementById('cfg-mon-name').value,
                monitorEmoji: document.getElementById('cfg-mon-emoji').value,
                adapter: {
                    ...(config.adapter || {}),
                    provider: document.getElementById('cfg-provider').value,
                    model: document.getElementById('cfg-model').value
                },
                memory: {
                    ...(config.memory || {}),
                    maxContextTokens: parseInt(document.getElementById('cfg-mem-tokens').value) || 120000
                },
                pulse: {
                    ...(config.pulse || {}),
                    intervalSeconds: parseInt(document.getElementById('cfg-pulse-interval').value) || 60
                },
                permissions: {
                    ...(config.permissions || {}),
                    allowShell: document.getElementById('cfg-perm-shell').value === 'true',
                    allowNetwork: document.getElementById('cfg-perm-network').value === 'true',
                    maxTimeout: parseInt(document.getElementById('cfg-perm-timeout').value) || 120000
                },
                tools: {
                    ...(config.tools || {}),
                    sandbox: document.getElementById('cfg-tool-sandbox').value === 'true'
                }
            };
            
            try {
                await api(`/api/blocks/${blockName}/config`, {
                    method: 'PUT',
                    body: JSON.stringify(updates)
                });
                showToast('Settings saved successfully.');
                renderBlockDetail(container, blockName);
            } catch (err) {
                showToast('Save failed: ' + err.message);
                btn.textContent = 'Save Config Changes';
                btn.disabled = false;
            }
        });

    } catch {
        container.innerHTML = '<div class="loading">error loading block details</div>';
    }
}

function formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return n.toString();
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}