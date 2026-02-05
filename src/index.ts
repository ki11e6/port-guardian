/**
 * Port Guardian - Programmatic API
 *
 * Stop debugging port conflicts. Start shipping.
 */

export { detectPorts } from './detector.js';
export { checkPort, checkPorts } from './scanner.js';
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
import { checkPorts } from './scanner.js';
import { resolveBlocker, generateWarnings } from './resolver.js';
import type { PortStatus, ScanResult } from './types.js';

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
