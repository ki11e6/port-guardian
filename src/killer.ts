/**
 * Process/Container Killer - Terminate blockers safely
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Blocker, ResolutionAction } from './types.js';

const execAsync = promisify(exec);

export interface KillResult {
  success: boolean;
  action: ResolutionAction;
  command: string;
  error?: string;
}

/**
 * Execute the suggested kill action for a blocker
 */
export async function killBlocker(
  blocker: Blocker,
  options: { force?: boolean; dryRun?: boolean } = {}
): Promise<KillResult> {
  const { force = false, dryRun = false } = options;

  const command = blocker.suggestedCommand;

  if (dryRun) {
    return {
      success: true,
      action: blocker.suggestedAction,
      command,
    };
  }

  try {
    switch (blocker.suggestedAction) {
      case 'kill-process':
        await killProcess(blocker.pid, force);
        break;

      case 'stop-container':
        await stopContainer(blocker.docker!.containerName);
        break;

      case 'stop-and-remove':
        await stopAndRemoveContainer(blocker.docker!.containerName);
        break;

      case 'systemctl-stop':
        // Future: systemctl stop <service>
        throw new Error('systemctl-stop not yet implemented');

      default:
        throw new Error(`Unknown action: ${blocker.suggestedAction}`);
    }

    return {
      success: true,
      action: blocker.suggestedAction,
      command,
    };
  } catch (error) {
    return {
      success: false,
      action: blocker.suggestedAction,
      command,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Kill a process by PID
 */
async function killProcess(pid: number, force: boolean = false): Promise<void> {
  const signal = force ? '-9' : '-15';
  await execAsync(`kill ${signal} ${pid}`);

  // Wait a moment for process to terminate
  await sleep(100);

  // Verify process is gone
  const stillRunning = await isProcessRunning(pid);
  if (stillRunning && !force) {
    // Try force kill
    await execAsync(`kill -9 ${pid}`);
    await sleep(100);
  }
}

/**
 * Stop a Docker container
 */
async function stopContainer(containerName: string): Promise<void> {
  await execAsync(`docker stop ${containerName}`);
}

/**
 * Stop and remove a Docker container
 */
async function stopAndRemoveContainer(containerName: string): Promise<void> {
  await execAsync(`docker stop ${containerName}`);
  await execAsync(`docker rm ${containerName}`);
}

/**
 * Check if a process is still running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    await execAsync(`kill -0 ${pid} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
