import type { GlobalConfig } from '@memoryblock/types';
import { loadGlobalConfig, resolveBlocksDir, resolveBlockPath, savePulseState, loadPulseState, loadBlockConfig, saveBlockConfig } from '@memoryblock/core';
import { pathExists } from '@memoryblock/core';
import { log } from '@memoryblock/core';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

const DAEMON_PKG = '@memoryblock/daemon';

/**
 * Stop a running block monitor.
 * Updates pulse state to SLEEPING.
 * In the MVP foreground model, this is mainly used for cleanup.
 */
export async function stopCommand(blockName?: string, options?: { preserveEnabled?: boolean }): Promise<void> {
  const globalConfig = await loadGlobalConfig();
  const blocksDir = resolveBlocksDir(globalConfig);

  if (!await pathExists(blocksDir)) {
    log.warn('No blocks directory found. Nothing to stop.');
    return;
  }

  if (blockName) {
    await stopBlock(globalConfig, blockName, options);
  } else {
    log.brand('Stopping all blocks...\n');
    const entries = await fsp.readdir(blocksDir, { withFileTypes: true });
    let stopped = 0;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('_')) {
        const didStop = await stopBlock(globalConfig, entry.name, options);
        if (didStop) stopped++;
      }
    }
    if (stopped === 0) {
      log.dim('  No active blocks to stop.');
    }
  }
}

async function stopBlock(globalConfig: GlobalConfig, name: string, options?: { preserveEnabled?: boolean }): Promise<boolean> {
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

  // Persist disabled state across reboots (unless preserveEnabled is set)
  if (!options?.preserveEnabled) {
    try {
      const blockConfig = await loadBlockConfig(blockPath);
      if (blockConfig.enabled !== false) {
        blockConfig.enabled = false;
        await saveBlockConfig(blockPath, blockConfig);
      }
    } catch { /* config read failure is non-critical */ }
  }

  if (daemonKilled) {
    log.success(`  ${name}: stopped (daemon process killed)`);
  } else {
    log.success(`  ${name}: stopped`);
  }
  
  return true;
}