/**
 * Blocker Resolver - Identify what's blocking a port
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  Blocker,
  DockerInfo,
  ProcessInfo,
  RestartPolicy,
  ContainerState,
} from './types.js';

const execAsync = promisify(exec);

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info >/dev/null 2>&1', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find container by port mapping
 */
export async function findContainerByPort(
  port: number
): Promise<DockerInfo | null> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "publish=${port}" --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}" 2>/dev/null`
    );

    const line = stdout.trim();
    if (!line) {
      return null;
    }

    const [containerId, containerName, image, state] = line.split('|');

    // Get detailed info including restart policy
    const inspectResult = await getContainerInspect(containerId);

    return {
      containerId,
      containerName,
      image,
      state: state as ContainerState,
      composeProject: inspectResult?.composeProject,
      restartPolicy: inspectResult?.restartPolicy ?? 'no',
    };
  } catch {
    return null;
  }
}

interface ContainerInspect {
  restartPolicy: RestartPolicy;
  composeProject?: string;
}

/**
 * Get container details from docker inspect
 */
async function getContainerInspect(
  containerId: string
): Promise<ContainerInspect | null> {
  try {
    const { stdout } = await execAsync(
      `docker inspect ${containerId} --format '{{.HostConfig.RestartPolicy.Name}}|{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null`
    );

    const [restartPolicy, composeProject] = stdout.trim().split('|');

    return {
      restartPolicy: (restartPolicy || 'no') as RestartPolicy,
      composeProject: composeProject || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a process to a full blocker description
 */
export async function resolveBlocker(
  process: ProcessInfo,
  port: number
): Promise<Blocker> {
  const isDockerProxy = process.command === 'docker-proxy';

  if (isDockerProxy && (await isDockerAvailable())) {
    return resolveDockerBlocker(process, port);
  }

  // Native process blocker
  return {
    type: 'native',
    pid: process.pid,
    processName: process.command,
    commandLine: process.args,
    isOrphanedDockerProxy: false,
    hasRestartLoop: false,
    suggestedAction: 'kill-process',
    suggestedCommand: `kill ${process.pid}`,
    requiresSudo: process.user === 'root',
    safeToAutoKill: false,
    isPermanentFix: true,
  };
}

/**
 * Resolve a docker-proxy process to container or orphan
 */
async function resolveDockerBlocker(
  process: ProcessInfo,
  port: number
): Promise<Blocker> {
  const docker = await findContainerByPort(port);

  if (docker) {
    // Container exists - determine if restart loop
    const hasRestartLoop =
      docker.restartPolicy === 'always' &&
      (docker.state === 'exited' || docker.state === 'dead');

    const suggestedAction =
      docker.restartPolicy === 'always' ? 'stop-and-remove' : 'stop-container';

    const suggestedCommand =
      suggestedAction === 'stop-and-remove'
        ? `docker stop ${docker.containerName} && docker rm ${docker.containerName}`
        : `docker stop ${docker.containerName}`;

    return {
      type: 'docker-container',
      pid: process.pid,
      processName: process.command,
      commandLine: process.args,
      docker,
      isOrphanedDockerProxy: false,
      hasRestartLoop,
      suggestedAction,
      suggestedCommand,
      requiresSudo: false,
      safeToAutoKill: false,
      isPermanentFix: suggestedAction === 'stop-and-remove',
    };
  }

  // Orphaned docker-proxy - no container found
  return {
    type: 'orphaned-docker-proxy',
    pid: process.pid,
    processName: process.command,
    commandLine: process.args,
    isOrphanedDockerProxy: true,
    hasRestartLoop: false,
    suggestedAction: 'kill-process',
    suggestedCommand: `kill ${process.pid}`,
    requiresSudo: true,
    safeToAutoKill: true,
    isPermanentFix: true,
  };
}

/**
 * Generate warnings based on blocker analysis
 */
export function generateWarnings(blocker: Blocker): string[] {
  const warnings: string[] = [];

  if (blocker.isOrphanedDockerProxy) {
    warnings.push(
      'Orphaned docker-proxy process detected. This is a stale process and is safe to kill.'
    );
  }

  if (blocker.hasRestartLoop) {
    warnings.push(
      'Container is in a restart loop (exited with restart:always policy). Simply stopping it may not be permanent.'
    );
  }

  if (
    blocker.docker?.restartPolicy === 'always' &&
    !blocker.hasRestartLoop
  ) {
    warnings.push(
      'Container has restart:always policy. It will auto-restart when Docker daemon restarts.'
    );
  }

  if (blocker.requiresSudo) {
    warnings.push('Root/sudo permissions may be required to kill this process.');
  }

  return warnings;
}
