import type { GlobalConfig } from '../../types.js';
import { loadGlobalConfig, resolveBlocksDir, resolveBlockPath, savePulseState, loadPulseState } from '../../utils/config.js';
import { pathExists } from '../../utils/fs.js';
import { log } from '../logger.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

const DAEMON_PKG = '@memoryblock/daemon';

/**
 * Stop a running block monitor.
 * Updates pulse state to SLEEPING.
 * In the MVP foreground model, this is mainly used for cleanup.
 */
export async function stopCommand(blockName?: string): Promise<void> {
  const globalConfig = await loadGlobalConfig();
  const blocksDir = resolveBlocksDir(globalConfig);

  if (!await pathExists(blocksDir)) {
    log.warn('No blocks directory found. Nothing to stop.');
    return;
  }

  if (blockName) {
    await stopBlock(globalConfig, blockName);
  } else {
    log.brand('Stopping all blocks...\n');
    const entries = await fsp.readdir(blocksDir, { withFileTypes: true });
    let stopped = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const didStop = await stopBlock(globalConfig, entry.name);
        if (didStop) stopped++;
      }
    }
    if (stopped === 0) {
      log.dim('  No active blocks to stop.');
    }
  }
}

async function stopBlock(globalConfig: GlobalConfig, name: string): Promise<boolean> {
  const blockPath = resolveBlockPath(globalConfig, name);

  if (!await pathExists(join(blockPath, 'pulse.json'))) {
    log.warn(`Block "${name}" not found.`);
    return false;
  }

  const pulse = await loadPulseState(blockPath);

  let daemonKilled = false;
  try {
    const daemon = await import(DAEMON_PKG);
    daemonKilled = await daemon.killDaemon(blockPath);
  } catch {
    // Daemon package not found or error parsing pid
  }

  if (pulse.status === 'SLEEPING' && !daemonKilled) {
    log.dim(`  ${name}: already sleeping`);
    return false;
  }

  await savePulseState(blockPath, {
    status: 'SLEEPING',
    lastRun: new Date().toISOString(),
    nextWakeUp: null,
    currentTask: null,
    error: null,
  });

  if (daemonKilled) {
    log.success(`  ${name}: stopped (daemon process killed)`);
  } else {
    log.success(`  ${name}: stopped`);
  }
  
  return true;
}
