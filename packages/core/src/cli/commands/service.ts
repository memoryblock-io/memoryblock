import { log } from '../logger.js';
import { getHome } from '../../utils/config.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const SERVICE_ID = 'io.memoryblock.daemon';
const SERVICE_LABEL = 'memoryblock';

/**
 * Get the path to the launchd plist or systemd unit file.
 */
function getServicePath(): string {
    const os = platform();
    if (os === 'darwin') {
        return join(process.env.HOME || '~', 'Library', 'LaunchAgents', `${SERVICE_ID}.plist`);
    } else if (os === 'linux') {
        return join(process.env.HOME || '~', '.config', 'systemd', 'user', `${SERVICE_LABEL}.service`);
    } else if (os === 'win32') {
        const appData = process.env.APPDATA || join(process.env.USERPROFILE || '~', 'AppData', 'Roaming');
        return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${SERVICE_LABEL}.vbs`);
    }
    throw new Error(`Unsupported platform: ${os}. Service management is available on macOS, Linux, and Windows.`);
}

/**
 * Resolve the mblk binary path — works in both dev (bun) and installed (node) modes.
 */
function getMblkBinaryPath(): string {
    // In dev mode: process.argv[1] is the TS source
    // After npm install: the bin wrapper is symlinked
    const scriptPath = process.argv[1];

    // If running from bun with .ts source, use bun to execute
    if (scriptPath.endsWith('.ts')) {
        const bunPath = join(process.env.HOME || '~', '.bun', 'bin', 'bun');
        return `${bunPath} ${scriptPath}`;
    }

    // Otherwise use node (installed via npm)
    return `${process.execPath} ${scriptPath}`;
}

/**
 * Generate launchd plist content for macOS.
 */
function generateLaunchdPlist(mblkCmd: string): string {
    const parts = mblkCmd.split(' ');
    const programArgs = parts.map(p => `        <string>${p}</string>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_ID}</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
        <string>restart</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>WorkingDirectory</key>
    <string>${process.cwd()}</string>
    <key>StandardOutPath</key>
    <string>${join(getHome(), 'service.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(getHome(), 'service.log')}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${process.env.PATH}</string>
        <key>HOME</key>
        <string>${process.env.HOME}</string>
    </dict>
</dict>
</plist>`;
}

/**
 * Generate systemd user unit content for Linux.
 */
function generateSystemdUnit(mblkCmd: string): string {
    return `[Unit]
Description=memoryblock - AI assistant daemon
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${mblkCmd} restart
ExecStop=${mblkCmd} shutdown
WorkingDirectory=${process.cwd()}
Environment="PATH=${process.env.PATH}"
Environment="HOME=${process.env.HOME}"

[Install]
WantedBy=default.target`;
}

/**
 * Generate a Windows VBScript to run mblk restart hidden.
 */
function generateWindowsVbs(mblkCmd: string): string {
    // VBScript to execute command without showing a console window
    return `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run "${mblkCmd} restart", 0, False`;
}

/**
 * Install memoryblock as a system service (runs on login/boot).
 */
export async function serviceInstallCommand(): Promise<void> {
    const os = platform();
    const servicePath = getServicePath();
    const mblkCmd = getMblkBinaryPath();

    log.brand('service install\n');

    // Write service file
    await fsp.mkdir(join(servicePath, '..'), { recursive: true });

    if (os === 'darwin') {
        const plist = generateLaunchdPlist(mblkCmd);
        await fsp.writeFile(servicePath, plist, 'utf-8');

        // Unload first if already loaded (ignore errors)
        try { execSync(`launchctl bootout gui/${process.getuid?.()} ${servicePath}`, { stdio: 'pipe' }); } catch { /* ignore */ }

        // Load the plist
        try {
            execSync(`launchctl bootstrap gui/${process.getuid?.()} ${servicePath}`, { stdio: 'pipe' });
            log.success('  Service installed and loaded.');
        } catch {
            // Fallback for older macOS
            try {
                execSync(`launchctl load ${servicePath}`, { stdio: 'pipe' });
                log.success('  Service installed and loaded.');
            } catch (err) {
                log.warn(`  Plist written but failed to load: ${(err as Error).message}`);
                log.dim(`  Try manually: launchctl load ${servicePath}`);
            }
        }
    } else if (os === 'linux') {
        const unit = generateSystemdUnit(mblkCmd);
        await fsp.writeFile(servicePath, unit, 'utf-8');

        try {
            execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
            execSync(`systemctl --user enable ${SERVICE_LABEL}`, { stdio: 'pipe' });
            log.success('  Service installed and enabled.');
            log.dim('  It will start automatically on next login.');
            log.dim(`  Start now: systemctl --user start ${SERVICE_LABEL}`);
        } catch (err) {
            log.warn(`  Unit file written but systemctl failed: ${(err as Error).message}`);
        }
    } else if (os === 'win32') {
        const vbs = generateWindowsVbs(mblkCmd);
        await fsp.writeFile(servicePath, vbs, 'utf-8');
        log.success('  Service installed to Windows Startup folder.');
        log.dim('  It will start automatically on next login.');
    }

    log.dim(`  File: ${servicePath}`);
    log.dim('  memoryblock will auto-start on boot/login.\n');
}

/**
 * Silently install the service in the background (used by start/server commands).
 * Catches all errors so it never interrupts the user.
 */
export async function silentServiceInstall(): Promise<void> {
    try {
        const os = platform();
        const servicePath = getServicePath();
        const mblkCmd = getMblkBinaryPath();

        await fsp.mkdir(join(servicePath, '..'), { recursive: true });

        // Generate content based on OS
        let content = '';
        if (os === 'darwin') {
            content = generateLaunchdPlist(mblkCmd);
        } else if (os === 'linux') {
            content = generateSystemdUnit(mblkCmd);
        } else if (os === 'win32') {
            content = generateWindowsVbs(mblkCmd);
        } else {
            return;
        }

        // Idempotency check: if the file exists and is identical, do nothing.
        // This prevents infinite reload loops where the service restarts itself.
        try {
            const existing = await fsp.readFile(servicePath, 'utf-8');
            if (existing === content) {
                return; // Already installed and up-to-date
            }
        } catch {
            // File doesn't exist, proceed with install
        }

        await fsp.writeFile(servicePath, content, 'utf-8');

        if (os === 'darwin') {
            try { execSync(`launchctl bootout gui/${process.getuid?.()} ${servicePath}`, { stdio: 'ignore' }); } catch { /* ignore */ }
            try {
                execSync(`launchctl bootstrap gui/${process.getuid?.()} ${servicePath}`, { stdio: 'ignore' });
            } catch {
                try { execSync(`launchctl load ${servicePath}`, { stdio: 'ignore' }); } catch { /* ignore */ }
            }
        } else if (os === 'linux') {
            try {
                execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
                execSync(`systemctl --user enable ${SERVICE_LABEL}`, { stdio: 'ignore' });
            } catch { /* ignore */ }
        }
    } catch {
        // Entirely silent
    }
}

/**
 * Uninstall the system service.
 */
export async function serviceUninstallCommand(): Promise<void> {
    const os = platform();
    const servicePath = getServicePath();

    log.brand('service uninstall\n');

    if (os === 'darwin') {
        try { execSync(`launchctl bootout gui/${process.getuid?.()} ${servicePath}`, { stdio: 'pipe' }); } catch { /* ignore */ }
        try { execSync(`launchctl unload ${servicePath}`, { stdio: 'pipe' }); } catch { /* ignore */ }
    } else if (os === 'linux') {
        try {
            execSync(`systemctl --user stop ${SERVICE_LABEL}`, { stdio: 'pipe' });
            execSync(`systemctl --user disable ${SERVICE_LABEL}`, { stdio: 'pipe' });
        } catch { /* ignore */ }
    } else if (os === 'win32') {
        // Nothing to stop gracefully on Windows for a startup script 
        // Admin could taskkill, but mblk shutdown handles cleanup
    }

    try {
        await fsp.unlink(servicePath);
        log.success('  Service removed.');
    } catch {
        log.dim('  No service file found. Nothing to remove.');
    }
    console.log('');
}

/**
 * Show service status.
 */
export async function serviceStatusCommand(): Promise<void> {
    const os = platform();
    const servicePath = getServicePath();

    log.brand('service status\n');

    // Check if service file exists
    try {
        await fsp.access(servicePath);
    } catch {
        log.dim('  Status: not installed');
        log.dim(`  Run \`mblk service install\` to enable auto-start.\n`);
        return;
    }

    log.success('  Status: installed');
    log.dim(`  File: ${servicePath}`);

    if (os === 'darwin') {
        try {
            const output = execSync(`launchctl list | grep ${SERVICE_ID}`, { stdio: 'pipe' }).toString().trim();
            if (output) {
                log.dim('  launchd: loaded');
            } else {
                log.dim('  launchd: not loaded');
            }
        } catch {
            log.dim('  launchd: not loaded');
        }
    } else if (os === 'linux') {
        try {
            const output = execSync(`systemctl --user is-active ${SERVICE_LABEL}`, { stdio: 'pipe' }).toString().trim();
            log.dim(`  systemd: ${output}`);
        } catch {
            log.dim('  systemd: inactive');
        }
    } else if (os === 'win32') {
        log.dim('  Windows Startup: active (file exists)');
    }
    console.log('');
}
