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
 * Check if a port is available using lsof
 */
export async function checkPort(port: number): Promise<LsofResult> {
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
    // lsof returns non-zero when no matches found
    return { available: true };
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
