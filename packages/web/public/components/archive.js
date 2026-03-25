// archive.js — Archive management component

import { showToast } from './create-block.js';

export function renderArchive(container, { apiBase, token }) {
    container.innerHTML = `
        <div class="archive-view">
            <div class="view-header">
                <h2>Archived Blocks</h2>
            </div>
            <div id="archive-list" class="archive-list">
                <div class="loading">Loading archives...</div>
            </div>
        </div>
    `;

    loadArchives(apiBase, token);
}

async function loadArchives(apiBase, token) {
    const listEl = document.getElementById('archive-list');

    try {
        const res = await fetch(`${apiBase}/api/archive`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();

        if (!data.archives || data.archives.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">📦</span>
                    <p>No archived blocks.</p>
                    <p class="dim">Deleted blocks appear here for safe recovery.</p>
                </div>
            `;
            return;
        }

        listEl.innerHTML = data.archives.map(a => `
            <div class="archive-card" data-name="${a.archiveName}">
                <div class="archive-info">
                    <span class="archive-name">${a.originalName}</span>
                    <span class="archive-date">${formatDate(a.archivedAt)}</span>
                </div>
                <div class="archive-actions">
                    <button class="action-btn" data-action="restore" data-archive="${a.archiveName}">
                        Restore
                    </button>
                    <button class="action-btn danger" data-action="delete" data-archive="${a.archiveName}">
                        Delete Forever
                    </button>
                </div>
            </div>
        `).join('');

        // Bind actions
        listEl.querySelectorAll('[data-action="restore"]').forEach(btn => {
            btn.addEventListener('click', () => handleRestore(btn.dataset.archive, apiBase, token));
        });
        listEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => handleDelete(btn.dataset.archive, apiBase, token));
        });
    } catch (err) {
        listEl.innerHTML = `<div class="error-state">Failed to load archives: ${err.message}</div>`;
    }
}

async function handleRestore(archiveName, apiBase, token) {
    if (!confirm(`Restore "${archiveName.split('_')[0]}" from archive?`)) return;

    try {
        const res = await fetch(`${apiBase}/api/archive/${archiveName}/restore`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('Block restored successfully.');
        loadArchives(apiBase, token);
    } catch (err) {
        showToast(`Restore failed: ${err.message}`);
    }
}

async function handleDelete(archiveName, apiBase, token) {
    if (!confirm(`Permanently delete "${archiveName}"? This cannot be undone.`)) return;

    try {
        const res = await fetch(`${apiBase}/api/archive/${archiveName}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('Permanently deleted.');
        loadArchives(apiBase, token);
    } catch (err) {
        showToast(`Delete failed: ${err.message}`);
    }
}

function formatDate(isoString) {
    if (!isoString) return 'Unknown date';
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}