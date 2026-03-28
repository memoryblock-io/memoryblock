/**
 * memoryblock web ui — setup wizard.
 * Multi-step card-based onboarding flow.
 * Only shown when no workspace is configured or on /setup route.
 */

const PROVIDERS = [
    { id: 'bedrock',   name: 'AWS Bedrock',        hint: 'Claude, Llama via AWS', fields: ['accessKeyId', 'secretAccessKey', 'region'] },
    { id: 'anthropic', name: 'Anthropic',           hint: 'Claude API direct', fields: ['apiKey'] },
    { id: 'openai',    name: 'OpenAI',              hint: 'GPT-4, GPT-4o', fields: ['apiKey'] },
    { id: 'gemini',    name: 'Google Gemini',        hint: 'Gemini Pro, Flash', fields: ['apiKey'] },
    { id: 'ollama',    name: 'Ollama (local)',       hint: 'No API key required', fields: [] },
];

const CHANNELS = [
    { id: 'cli',      name: 'Terminal (CLI)',  hint: 'always enabled', locked: true },
    { id: 'telegram', name: 'Telegram',        hint: 'bot token required', fields: ['botToken', 'chatId'] },
    { id: 'discord',  name: 'Discord',         hint: 'coming soon', disabled: true },
    { id: 'slack',    name: 'Slack',            hint: 'coming soon', disabled: true },
];

const PLUGINS = [
    { id: 'agents',        name: 'Multi-Agent Orchestration', locked: true, installed: true },
    { id: 'web-search',    name: 'Web Search',                locked: false, installed: false },
    { id: 'fetch-webpage', name: 'Fetch Webpage',             locked: false, installed: false },
    { id: 'aws',           name: 'AWS Tools',                 locked: false, installed: false },
];

const STEPS = ['welcome', 'providers', 'channels', 'plugins', 'credentials', 'block', 'finish'];

/**
 * Render the setup wizard
 */
export function renderSetup(container, { api, onComplete }) {
    let currentStep = 0;
    let selections = {
        providers: ['bedrock'],
        channels: ['cli'],
        plugins: ['agents'],
        credentials: {},
        blockName: 'home',
    };

    function render() {
        const step = STEPS[currentStep];
        container.innerHTML = `
            <div class="setup-overlay">
                <div class="setup-container">
                    <div class="setup-progress">
                        ${STEPS.map((s, i) => `<div class="setup-dot ${i === currentStep ? 'active' : i < currentStep ? 'done' : ''}"></div>`).join('')}
                    </div>
                    <div class="setup-card" id="setup-card">
                        ${renderStep(step)}
                    </div>
                </div>
            </div>
        `;
        bindEvents(step);
    }

    function renderStep(step) {
        switch (step) {
            case 'welcome': return `
                <div class="setup-welcome">
                    <div class="setup-logo"><svg width="48" height="52" viewBox="0 0 24 26" fill="none"><defs><linearGradient id="hexGradSetup" x1="0" y1="0" x2="24" y2="26"><stop offset="0%" class="hex-stop1" style="stop-color:#7C3AED"><animate attributeName="stop-color" values="#7C3AED;#AF52DE;#b344ff;#ff4a5a;#7C3AED" dur="4s" repeatCount="indefinite"/></stop><stop offset="50%" class="hex-stop2" style="stop-color:#AF52DE"><animate attributeName="stop-color" values="#AF52DE;#b344ff;#ff4a5a;#7C3AED;#AF52DE" dur="4s" repeatCount="indefinite"/></stop><stop offset="100%" class="hex-stop3" style="stop-color:#b344ff"><animate attributeName="stop-color" values="#b344ff;#ff4a5a;#7C3AED;#AF52DE;#b344ff" dur="4s" repeatCount="indefinite"/></stop></linearGradient></defs><path d="M12 1L22 7v12l-10 6L2 19V7l10-6z" stroke="url(#hexGradSetup)" stroke-width="2" fill="none"/></svg></div>
                    <h1>memoryblock</h1>
                    <p class="setup-subtitle">Deploy isolated AI workspaces on your machine.</p>
                    <p class="setup-hint">Let's set things up. You can skip any step.</p>
                    <div class="setup-actions">
                        <button class="btn-primary" id="setup-next">Get Started</button>
                        <button class="btn-ghost" id="setup-skip-all">Skip to Dashboard</button>
                    </div>
                </div>`;

            case 'providers': return `
                <h2>Choose Providers</h2>
                <p class="setup-hint">Select the AI providers you want to use.</p>
                <div class="setup-options">
                    ${PROVIDERS.map(p => `
                        <label class="setup-option ${selections.providers.includes(p.id) ? 'selected' : ''}">
                            <input type="checkbox" value="${p.id}" ${selections.providers.includes(p.id) ? 'checked' : ''}>
                            <span class="option-name">${p.name}</span>
                            <span class="option-hint">${p.hint}</span>
                        </label>
                    `).join('')}
                </div>
                <div class="setup-actions">
                    <button class="btn-ghost" id="setup-back">Back</button>
                    <button class="btn-ghost" id="setup-skip">Skip</button>
                    <button class="btn-primary" id="setup-next">Next</button>
                </div>`;

            case 'channels': return `
                <h2>Enable Channels</h2>
                <p class="setup-hint">How do you want to talk to your blocks?</p>
                <div class="setup-options">
                    ${CHANNELS.map(ch => `
                        <label class="setup-option ${ch.locked ? 'locked' : ''} ${ch.disabled ? 'disabled' : ''} ${selections.channels.includes(ch.id) ? 'selected' : ''}">
                            <input type="checkbox" value="${ch.id}" 
                                ${selections.channels.includes(ch.id) ? 'checked' : ''}
                                ${ch.locked || ch.disabled ? 'disabled' : ''}>
                            <span class="option-name">${ch.name}</span>
                            <span class="option-hint">${ch.hint}</span>
                        </label>
                    `).join('')}
                </div>
                <div class="setup-actions">
                    <button class="btn-ghost" id="setup-back">Back</button>
                    <button class="btn-ghost" id="setup-skip">Skip</button>
                    <button class="btn-primary" id="setup-next">Next</button>
                </div>`;

            case 'plugins': return `
                <h2>Plugins</h2>
                <p class="setup-hint">Extend your blocks with additional capabilities.</p>
                <div class="setup-plugins-table">
                    <div class="plugin-header">
                        <span>Plugin</span>
                        <span>Status</span>
                    </div>
                    ${PLUGINS.map(pl => `
                        <div class="plugin-row ${pl.locked ? 'locked' : ''}">
                            <span class="plugin-name">${pl.name}</span>
                            <label class="plugin-toggle">
                                <input type="checkbox" value="${pl.id}"
                                    ${pl.installed || selections.plugins.includes(pl.id) ? 'checked' : ''}
                                    ${pl.locked ? 'disabled' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    `).join('')}
                </div>
                <div class="setup-actions">
                    <button class="btn-ghost" id="setup-back">Back</button>
                    <button class="btn-ghost" id="setup-skip">Skip</button>
                    <button class="btn-primary" id="setup-next">Next</button>
                </div>`;

            case 'credentials': return renderCredentialsStep();

            case 'block': return `
                <h2>Your First Block</h2>
                <p class="setup-hint">A block is an isolated AI workspace with its own memory.</p>
                <div class="setup-field">
                    <label>Block Name</label>
                    <input type="text" id="block-name" value="${selections.blockName}" placeholder="home"
                           pattern="[a-z0-9][a-z0-9\\-]{0,31}">
                    <span class="field-hint">lowercase, numbers, hyphens (max 32)</span>
                </div>
                <div class="setup-actions">
                    <button class="btn-ghost" id="setup-back">Back</button>
                    <button class="btn-primary" id="setup-next">Create & Finish</button>
                </div>`;

            case 'finish': return `
                <div class="setup-welcome">
                    <div class="setup-logo done"><svg width="48" height="52" viewBox="0 0 24 26" fill="none"><defs><linearGradient id="hexGradDone" x1="0" y1="0" x2="24" y2="26"><stop offset="0%" style="stop-color:var(--success)"/><stop offset="100%" style="stop-color:#34c759"/></linearGradient></defs><path d="M12 1L22 7v12l-10 6L2 19V7l10-6z" stroke="url(#hexGradDone)" stroke-width="2" fill="none"/><path d="M8 13l3 3 5-6" stroke="url(#hexGradDone)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                    <h1>You're all set</h1>
                    <div class="setup-summary" id="setup-results"></div>
                    <div class="setup-actions">
                        <button class="btn-primary" id="setup-launch">Launch Dashboard</button>
                    </div>
                </div>`;
        }
    }

    function renderCredentialsStep() {
        // Show fields only for selected providers and channels
        const fields = [];

        for (const pid of selections.providers) {
            const provider = PROVIDERS.find(p => p.id === pid);
            if (!provider || provider.fields.length === 0) continue;
            fields.push(`<h3>${provider.name}</h3>`);
            for (const f of provider.fields) {
                const key = `${pid}.${f}`;
                const val = selections.credentials[key] || '';
                const isSecret = f !== 'region' && f !== 'chatId';
                fields.push(`
                    <div class="setup-field">
                        <label>${f.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</label>
                        <input type="${isSecret ? 'password' : 'text'}" data-key="${key}" value="${val}"
                               placeholder="${f === 'region' ? 'us-east-1' : ''}">
                    </div>
                `);
            }
        }

        for (const cid of selections.channels) {
            const channel = CHANNELS.find(c => c.id === cid);
            if (!channel?.fields) continue;
            fields.push(`<h3>${channel.name}</h3>`);
            for (const f of channel.fields) {
                const key = `${cid}.${f}`;
                const val = selections.credentials[key] || '';
                const isSecret = f === 'botToken';
                fields.push(`
                    <div class="setup-field">
                        <label>${f.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</label>
                        <input type="${isSecret ? 'password' : 'text'}" data-key="${key}" value="${val}">
                    </div>
                `);
            }
        }

        if (fields.length === 0) {
            fields.push('<p class="setup-hint">No credentials needed for the selected services.</p>');
        }

        return `
            <h2>Credentials</h2>
            <p class="setup-hint">Enter API keys for the services you selected.</p>
            <div class="setup-credentials">${fields.join('')}</div>
            <div id="connection-status"></div>
            <div class="setup-actions">
                <button class="btn-ghost" id="setup-back">Back</button>
                <button class="btn-ghost" id="setup-skip">Skip</button>
                <button class="btn-primary" id="setup-next">Test & Continue</button>
            </div>`;
    }

    function bindEvents(step) {
        const next = document.getElementById('setup-next');
        const back = document.getElementById('setup-back');
        const skip = document.getElementById('setup-skip');
        const skipAll = document.getElementById('setup-skip-all');
        const launch = document.getElementById('setup-launch');

        if (next) next.addEventListener('click', () => handleNext(step));
        if (back) back.addEventListener('click', () => { currentStep--; render(); });
        if (skip) skip.addEventListener('click', () => { currentStep++; render(); });
        if (skipAll) skipAll.addEventListener('click', () => onComplete());
        if (launch) launch.addEventListener('click', () => onComplete());

        // Checkbox bindings
        if (step === 'providers' || step === 'channels') {
            const key = step;
            container.querySelectorAll('.setup-option input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', () => {
                    const checked = [...container.querySelectorAll('.setup-option input:checked')].map(c => c.value);
                    selections[key] = checked;
                    render();
                });
            });
        }

        if (step === 'plugins') {
            container.querySelectorAll('.plugin-row input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', () => {
                    const checked = [...container.querySelectorAll('.plugin-row input:checked')].map(c => c.value);
                    selections.plugins = checked;
                });
            });
        }

        if (step === 'credentials') {
            container.querySelectorAll('.setup-credentials input').forEach(inp => {
                inp.addEventListener('input', () => {
                    selections.credentials[inp.dataset.key] = inp.value;
                });
            });
        }

        // Show connection test results on finish step
        if (step === 'finish') {
            const el = document.getElementById('setup-results');
            if (el) {
                const lines = [];
                if (selections.providers.length) lines.push(`<p>Providers: ${selections.providers.join(', ')}</p>`);
                if (selections.channels.length) lines.push(`<p>Channels: ${selections.channels.join(', ')}</p>`);
                lines.push(`<p>Block: <strong>${selections.blockName}</strong></p>`);
                el.innerHTML = lines.join('');
            }
        }
    }

    async function handleNext(step) {
        if (step === 'block') {
            const input = document.getElementById('block-name');
            if (input) selections.blockName = input.value || 'home';

            // Save configuration via API
            try {
                await api('/api/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(selections),
                });
            } catch { }
        }

        currentStep++;
        if (currentStep >= STEPS.length) {
            onComplete();
        } else {
            render();
        }
    }

    render();
}