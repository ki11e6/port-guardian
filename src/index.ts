/**
 * Port Guardian - Programmatic API
 *
 * Stop debugging port conflicts. Start shipping.
 */

export { detectPorts } from './detector.js';
export { checkPort, checkPorts, findAvailablePort } from './scanner.js';
export { resolveBlocker, generateWarnings, isDockerAvailable } from './resolver.js';
export { killBlocker } from './killer.js';

export type {
  PortSource,
  PortStatus,
  ScanResult,
  Blocker,
  BlockerType,
  DockerInfo,
  RestartPolicy,
  ContainerState,
  ResolutionAction,
  PortGuardianConfig,
  CliOptions,
  DetectOptions,
} from './types.js';

/**
 * High-level API: Scan ports and return results
 */
import { detectPorts } from './detector.js';
import { checkPort, checkPorts } from './scanner.js';
import { resolveBlocker, generateWarnings } from './resolver.js';
import { killBlocker } from './killer.js';
import type { PortStatus, ScanResult, BlockerType } from './types.js';

export interface ScanOptions {
  ports?: number[];
  cwd?: string;
}

/**
 * Scan ports for conflicts
 *
 * @example
 * ```ts
 * import { scan } from 'port-guardian';
 *
 * const result = await scan({ ports: [3000, 8080] });
 * console.log(result.hasConflicts);
 * ```
 */
export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
  const { ports: explicitPorts, cwd } = options;

  // Get ports to check
  let ports: number[];

  if (explicitPorts && explicitPorts.length > 0) {
    ports = explicitPorts;
  } else {
    const sources = await detectPorts(cwd);
    ports = sources.map((s) => s.port);
  }

  if (ports.length === 0) {
    return {
      ports: [],
      hasConflicts: false,
      conflictCount: 0,
    };
  }

  // Scan ports
  const scanResults = await checkPorts(ports);

  // Build port status with resolution
  const portStatuses: PortStatus[] = [];

  for (const port of ports) {
    const result = scanResults.get(port);

    if (!result || result.available) {
      portStatuses.push({
        port,
        available: true,
        warnings: [],
      });
    } else if (result.process) {
      const blocker = await resolveBlocker(result.process, port);
      const warnings = generateWarnings(blocker);

      portStatuses.push({
        port,
        available: false,
        blocker,
        warnings,
      });
    } else {
      // Port is blocked but we couldn't identify the process
      portStatuses.push({
        port,
        available: false,
        warnings: ['Unable to identify blocking process. Try running with sudo.'],
      });
    }
  }

  return {
    ports: portStatuses,
    hasConflicts: portStatuses.some((p) => !p.available),
    conflictCount: portStatuses.filter((p) => !p.available).length,
  };
}

export interface KillPortResult {
  port: number;
  killed: boolean;
  wasAvailable: boolean;
  blocker?: {
    pid: number;
    process: string;
    type: BlockerType;
    docker?: { containerName: string; image: string };
  };
  command?: string;
  error?: string;
}

/**
 * Kill the process occupying a port.
 * If the port is already available, returns immediately with wasAvailable: true.
 *
 * @example
 * ```ts
 * import { killPort } from 'port-guardian';
 *
 * const result = await killPort(3000);
 * console.log(result.killed); // true
 * ```
 */
export async function killPort(
  port: number,
  options: { dryRun?: boolean; force?: boolean } = {}
): Promise<KillPortResult> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}. Must be an integer between 1 and 65535.`);
  }

  const scan = await checkPort(port);

  if (scan.available) {
    return { port, killed: false, wasAvailable: true };
  }

  if (!scan.process) {
    return {
      port,
      killed: false,
      wasAvailable: false,
      error: 'Could not identify blocking process. Try running with sudo.',
    };
  }

  const blocker = await resolveBlocker(scan.process, port);
  const result = await killBlocker(blocker, options);

  const blockerInfo: KillPortResult['blocker'] = {
    pid: blocker.pid,
    process: blocker.processName,
    type: blocker.type,
  };

  if (blocker.docker) {
    blockerInfo.docker = {
      containerName: blocker.docker.containerName,
      image: blocker.docker.image,
    };
  }

  return {
    port,
    killed: result.success,
    wasAvailable: false,
    blocker: blockerInfo,
    command: result.command,
    error: result.error,
  };
}
