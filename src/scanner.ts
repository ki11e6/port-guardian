/**
 * Port Scanner - Check port availability using system tools
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessInfo } from './types.js';

const execAsync = promisify(exec);

// Cache docker availability for the lifetime of the process
let dockerAvailableCache: boolean | null = null;

async function isDockerReachable(): Promise<boolean> {
  if (dockerAvailableCache !== null) return dockerAvailableCache;
  try {
    await execAsync('docker info >/dev/null 2>&1', { timeout: 5000 });
    dockerAvailableCache = true;
  } catch {
    dockerAvailableCache = false;
  }
  return dockerAvailableCache;
}

export interface LsofResult {
  available: boolean;
  process?: ProcessInfo;
}

/**
 * Validate port is an integer in the valid range
 */
function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}. Must be an integer between 1 and 65535.`);
  }
}

/**
 * Check if a port is available using multiple detection methods
 */
export async function checkPort(port: number): Promise<LsofResult> {
  validatePort(port);

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
    // Fields are whitespace-separated but NAME (field 9+) can contain spaces
    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      return { available: true };
    }

    const command = parts[0];
    const pid = parseInt(parts[1], 10);
    const user = parts[2];

    // NAME field (index 8+) may contain spaces - rejoin everything from index 8
    const args = parts.length > 8 ? parts.slice(8).join(' ') : undefined;

    return {
      available: false,
      process: {
        pid,
        command,
        user,
        args,
      },
    };
  } catch {
    return { available: true };
  }
}

/**
 * Check port with ss (Linux) or netstat (macOS)
 * Sees kernel-level bindings including root processes
 */
async function checkPortWithSs(port: number): Promise<LsofResult> {
  const isMacOS = process.platform === 'darwin';

  try {
    let stdout: string;

    if (isMacOS) {
      // macOS: use netstat
      const result = await execAsync(
        `netstat -anv -p tcp 2>/dev/null | grep '\\.${port}\\s' | grep LISTEN`
      );
      stdout = result.stdout;
    } else {
      // Linux: use ss
      const result = await execAsync(
        `ss -tlnH 'sport = :${port}' 2>/dev/null`
      );
      stdout = result.stdout;
    }

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
    // Check if docker is available (cached)
    if (!(await isDockerReachable())) return null;

    // Find container by published port
    const { stdout } = await execAsync(
      `docker ps --filter "publish=${port}" --format "{{.ID}}|{{.Names}}" 2>/dev/null`,
      { timeout: 5000 }
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
      `pgrep -f "docker-proxy.*-host-port ${port}" 2>/dev/null`,
      { timeout: 5000 }
    );
    const pid = parseInt(stdout.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Find the first available port starting from a base port.
 * Walks upward from basePort, returning the first port that is not in use.
 * If no basePort is provided, picks a random ephemeral port (49152-65535).
 *
 * @param basePort - Port to start searching from (default: random ephemeral)
 * @param maxAttempts - Maximum number of ports to try (default: 100)
 * @returns The first available port number
 * @throws Error if no available port is found within maxAttempts
 */
export async function findAvailablePort(
  basePort?: number,
  maxAttempts = 100
): Promise<number> {
  if (basePort !== undefined) {
    validatePort(basePort);
  }

  const start =
    basePort ?? Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;

  for (let i = 0; i < maxAttempts; i++) {
    const port = start + i;
    if (port > 65535) break;

    const result = await checkPort(port);
    if (result.available) {
      return port;
    }
  }

  throw new Error(
    `No available port found after ${maxAttempts} attempts (starting from ${start})`
  );
}

/**
 * Check multiple ports in parallel
 */
export async function checkPorts(
  ports: number[]
): Promise<Map<number, LsofResult>> {
  for (const port of ports) {
    validatePort(port);
  }

  const results = await Promise.all(
    ports.map(async (port) => ({
      port,
      result: await checkPort(port),
    }))
  );

  return new Map(results.map(({ port, result }) => [port, result]));
}

