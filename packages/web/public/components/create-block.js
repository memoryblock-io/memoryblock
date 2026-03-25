// create-block.js — Block creation form component

export function renderCreateBlock(container, { apiBase, token, onCreated }) {
    container.innerHTML = `
        <div class="create-block-view">
            <div class="view-header" style="margin-bottom: 24px;">
                <button class="back-btn" id="create-back">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px; vertical-align:text-bottom;"><path d="m15 18-6-6 6-6"/></svg> back to blocks
                </button>
            </div>
            
            <div class="create-card" style="background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 48px; text-align: center; max-width: 540px; margin: 32px auto 0; box-shadow: 0 10px 40px rgba(0,0,0,0.15);">
                <div class="create-icon" style="background: var(--accent-glow); color: var(--accent); width: 72px; height: 72px; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 24px;">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                </div>
                <h2 style="font-size: 1.8rem; margin-bottom: 12px; font-weight: 600; font-family: 'Outfit', sans-serif;">Deploy a New Block</h2>
                <p style="color: var(--text-dim); margin-bottom: 40px; font-size: 1.05rem; line-height: 1.5;">Create an isolated intelligence wrapper primitive. Highly optimized background daemons for massive scaled logic flow tracking.</p>
                
                <form id="create-block-form" class="create-form" style="text-align: left;">
                    <div class="form-group">
                        <label for="block-name" style="font-weight: 500; display: block; margin-bottom: 12px; color: var(--text);">Block Identifier <span style="color:var(--text-dim);font-weight:400;font-size:0.85rem;margin-left:8px;">(lowercase, hyphens)</span></label>
                        <input type="text" id="block-name" class="form-input" style="width: 100%; padding: 16px 18px; font-size: 1.15rem; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); transition: border-color 0.2s;"
                            placeholder="e.g. data-analyzer"
                            pattern="[a-z0-9][a-z0-9\\-]{0,31}"
                            required
                            autocomplete="off" />
                    </div>
                    <div id="create-error" class="form-error" style="display:none; color: var(--error); background: rgba(255,59,48,0.1); padding: 14px; border-radius: 8px; margin-top: 16px; font-size: 0.95rem; border: 1px solid rgba(255,59,48,0.2);"></div>
                    
                    <button type="submit" class="action-btn primary" id="create-submit" style="width: 100%; padding: 18px; margin-top: 32px; font-size: 1.1rem; justify-content: center; border-radius: 12px; font-weight: 600;">
                        Initialize Primitive
                    </button>
                </form>
            </div>
        </div>
    `;

    // Back button
    document.getElementById('create-back').addEventListener('click', () => {
        window.location.hash = '#/blocks';
    });

    // Name validation in real-time
    const nameInput = document.getElementById('block-name');
    nameInput.addEventListener('input', () => {
        const val = nameInput.value;
        const valid = /^[a-z0-9][a-z0-9\-]{0,31}$/.test(val);
        nameInput.classList.toggle('invalid', val.length > 0 && !valid);
    });

    // Submit
    document.getElementById('create-block-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const errorEl = document.getElementById('create-error');
        const submitBtn = document.getElementById('create-submit');

        if (!/^[a-z0-9][a-z0-9\-]{0,31}$/.test(name)) {
            errorEl.textContent = 'Invalid name. Use lowercase letters, numbers, and hyphens only.';
            errorEl.style.display = 'block';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
        errorEl.style.display = 'none';

        try {
            const res = await fetch(`${apiBase}/api/blocks`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to create block');

            showToast(`Block "${name}" created successfully.`);
            if (onCreated) onCreated(name);
            window.location.hash = '#/blocks';
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Block';
        }
    });

    // Focus
    nameInput.focus();
}

// Toast notification helper
export function showToast(message, duration = 3000) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), duration);
}