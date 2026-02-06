/**
 * CLI Interactive Resolution - Prompt-based conflict resolution
 */

import { killBlocker } from './killer.js';
import { printRestartWarning, printSuccess, printError, printInfo } from './ui.js';
import type { PortStatus, CliOptions, Blocker } from './types.js';

interface Choice {
  name: string;
  value: string;
}

/**
 * Force kill all blockers
 */
export async function forceKillAll(
  portStatuses: PortStatus[],
  options: CliOptions
): Promise<void> {
  const blockedPorts = portStatuses.filter((p) => !p.available && p.blocker);

  for (const port of blockedPorts) {
    const result = await killBlocker(port.blocker!, { dryRun: options.dryRun, force: true });

    if (result.success) {
      printSuccess(`Port ${port.port}: ${result.command}`);
    } else {
      printError(`Port ${port.port}: ${result.error}`);
    }
  }
}

/**
 * Interactive resolution flow
 */
export async function interactiveResolve(
  portStatuses: PortStatus[],
  options: CliOptions
): Promise<void> {
  const blockedPorts = portStatuses.filter((p) => !p.available && p.blocker);
  const { select } = await import('@inquirer/prompts');

  for (const port of blockedPorts) {
    const blocker = port.blocker!;

    // Show restart warning if applicable
    if (blocker.docker?.restartPolicy === 'always') {
      printRestartWarning();
    }

    const choices = buildActionChoices(blocker);

    const action = await select({
      message: `Port ${port.port} - Choose action:`,
      choices,
    });

    if (action === 'skip') {
      printInfo(`Skipped port ${port.port}`);
      continue;
    }

    if (action === 'abort') {
      printInfo('Aborted');
      process.exit(1);
    }

    // Execute the action
    const result = await killBlocker(blocker, { dryRun: options.dryRun });

    if (result.success) {
      printSuccess(`Executed: ${result.command}`);
    } else {
      printError(`Failed: ${result.error}`);
    }
  }
}

/**
 * Build action choices based on blocker type
 */
export function buildActionChoices(blocker: Blocker): Choice[] {
  const choices: Choice[] = [];

  if (blocker.isOrphanedDockerProxy) {
    choices.push({
      name: 'Kill orphaned docker-proxy (recommended, safe)',
      value: 'kill',
    });
  } else if (blocker.type === 'docker-container') {
    if (blocker.docker?.restartPolicy === 'always') {
      choices.push({
        name: `Stop and remove container (recommended, permanent)`,
        value: 'stop-and-remove',
      });
      choices.push({
        name: `Stop container only (may restart)`,
        value: 'stop',
      });
    } else {
      choices.push({
        name: `Stop container`,
        value: 'stop',
      });
    }
  } else {
    choices.push({
      name: `Kill process (PID ${blocker.pid})`,
      value: 'kill',
    });
  }

  choices.push({ name: 'Skip this port', value: 'skip' });
  choices.push({ name: 'Abort', value: 'abort' });

  return choices;
}
