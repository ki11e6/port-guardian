/**
 * Port Scanner - Check port availability using system tools
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessInfo } from './types.js';

const execAsync = promisify(exec);

export interface LsofResult {
  available: boolean;
  process?: ProcessInfo;
}

/**
 * Check if a port is available using multiple detection methods
 */
export async function checkPort(port: number): Promise<LsofResult> {
  // Try lsof first (works for user-owned processes)
  const lsofResult = await checkPortWithLsof(port);
  if (!lsofResult.available) {
    return lsofResult;
  }

  // lsof might miss root-owned processes like docker-proxy
  // Try ss to see if port is bound at kernel level
  const ssResult = await checkPortWithSs(port);
  if (!ssResult.available) {
    // Port is bound but lsof didn't see it - likely docker-proxy or root process
    // Try to identify via docker
    const dockerResult = await checkPortWithDocker(port);
    if (dockerResult) {
      return dockerResult;
    }
    // Fall back to generic "unknown root process"
    return ssResult;
  }

  return { available: true };
}

/**
 * Check port with lsof (best for user-owned processes)
 */
async function checkPortWithLsof(port: number): Promise<LsofResult> {
  try {
    const { stdout } = await execAsync(
      `lsof -i :${port} -P -n -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -1`
    );

    const line = stdout.trim();
    if (!line) {
      return { available: true };
    }

    // Parse lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      return { available: true };
    }

    const [command, pidStr, user] = parts;
    const pid = parseInt(pidStr, 10);

    return {
      available: false,
      process: {
        pid,
        command,
        user,
        args: parts.slice(8).join(' '),
      },
    };
  } catch {
    return { available: true };
  }
}

/**
 * Check port with ss (sees kernel-level bindings including root processes)
 */
async function checkPortWithSs(port: number): Promise<LsofResult> {
  try {
    const { stdout } = await execAsync(
      `ss -tlnH 'sport = :${port}' 2>/dev/null`
    );

    const line = stdout.trim();
    if (!line) {
      return { available: true };
    }

    // Port is bound at kernel level but we don't know by what
    return {
      available: false,
      process: {
        pid: 0,
        command: 'unknown',
        user: 'root',
        args: `Port ${port} is bound (root process, use sudo for details)`,
      },
    };
  } catch {
    return { available: true };
  }
}

/**
 * Check if Docker has a container on this port
 */
async function checkPortWithDocker(port: number): Promise<LsofResult | null> {
  try {
    // Check if docker is available
    await execAsync('docker info >/dev/null 2>&1');

    // Find container by published port
    const { stdout } = await execAsync(
      `docker ps --filter "publish=${port}" --format "{{.ID}}|{{.Names}}" 2>/dev/null`
    );

    const line = stdout.trim();
    if (!line) {
      // No container found - might be orphaned docker-proxy
      const dockerProxyPid = await findDockerProxyPid(port);
      if (dockerProxyPid) {
        return {
          available: false,
          process: {
            pid: dockerProxyPid,
            command: 'docker-proxy',
            user: 'root',
            args: `Orphaned docker-proxy for port ${port}`,
          },
        };
      }
      return null;
    }

    const [containerId, containerName] = line.split('|');

    // Find the docker-proxy PID for this port
    const dockerProxyPid = await findDockerProxyPid(port);

    return {
      available: false,
      process: {
        pid: dockerProxyPid || 0,
        command: 'docker-proxy',
        user: 'root',
        args: `Container: ${containerName} (${containerId.slice(0, 12)})`,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Find docker-proxy PID for a specific port
 */
async function findDockerProxyPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `pgrep -f "docker-proxy.*-host-port ${port}" 2>/dev/null`
    );
    const pid = parseInt(stdout.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Check multiple ports in parallel
 */
export async function checkPorts(
  ports: number[]
): Promise<Map<number, LsofResult>> {
  const results = await Promise.all(
    ports.map(async (port) => ({
      port,
      result: await checkPort(port),
    }))
  );

  return new Map(results.map(({ port, result }) => [port, result]));
}

/**
 * Get full command line for a process
 */
export async function getProcessCommandLine(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`ps -p ${pid} -o args= 2>/dev/null`);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
