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
 * Validate PID is a positive integer
 */
function validatePid(pid: number): number {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid PID: ${pid}`);
  }
  return pid;
}

/**
 * Kill a process by PID
 */
async function killProcess(pid: number, force: boolean = false): Promise<void> {
  const safePid = validatePid(pid);
  const signal = force ? '-9' : '-15';

  try {
    await execAsync(`kill ${signal} ${safePid}`);
  } catch (error) {
    // Process already gone (ESRCH) — that's a success, port is free
    if (isNoSuchProcessError(error)) return;
    throw error;
  }

  // Wait for process to handle signal and shut down gracefully
  await sleep(500);

  // Verify process is gone
  const stillRunning = await isProcessRunning(safePid);
  if (stillRunning && !force) {
    // Escalate to force kill
    try {
      await execAsync(`kill -9 ${safePid}`);
    } catch (error) {
      if (isNoSuchProcessError(error)) return;
      throw error;
    }
    await sleep(200);
  }
}

/**
 * Sanitize container name to prevent command injection
 */
function sanitizeContainerName(name: string): string {
  // Docker container names can only contain [a-zA-Z0-9][a-zA-Z0-9_.-]
  // Reject anything that doesn't match this pattern
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  return name;
}

/**
 * Stop a Docker container
 */
async function stopContainer(containerName: string): Promise<void> {
  const safeName = sanitizeContainerName(containerName);
  await execAsync(`docker stop -t 3 ${safeName}`, { timeout: 15000 });
}

/**
 * Stop and remove a Docker container
 */
async function stopAndRemoveContainer(containerName: string): Promise<void> {
  const safeName = sanitizeContainerName(containerName);
  await execAsync(`docker stop -t 3 ${safeName}`, { timeout: 15000 });
  await execAsync(`docker rm ${safeName}`, { timeout: 10000 });
}

/**
 * Check if an error is ESRCH (No such process) — process already terminated
 */
function isNoSuchProcessError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('No such process');
  }
  return false;
}

/**
 * Check if a process is still running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  const safePid = validatePid(pid);
  try {
    await execAsync(`kill -0 ${safePid} 2>/dev/null`);
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
