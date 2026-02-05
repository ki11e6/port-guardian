/**
 * Port Guardian - Type Definitions
 */

export type BlockerType =
  | 'native'
  | 'docker-container'
  | 'orphaned-docker-proxy';

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure';

export type ContainerState = 'running' | 'exited' | 'dead' | 'paused' | 'created';

export type ResolutionAction =
  | 'kill-process'
  | 'stop-container'
  | 'stop-and-remove';

export interface PortSource {
  port: number;
  name?: string;
  source: string;
  confidence: number;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  user: string;
  args?: string;
}

export interface DockerInfo {
  containerName: string;
  containerId: string;
  image: string;
  state: ContainerState;
  composeProject?: string;
  restartPolicy: RestartPolicy;
}

export interface Blocker {
  type: BlockerType;
  pid: number;
  processName: string;
  commandLine?: string;

  // Docker-specific
  docker?: DockerInfo;

  // Analysis flags
  isOrphanedDockerProxy: boolean;
  hasRestartLoop: boolean;

  // Resolution
  suggestedAction: ResolutionAction;
  suggestedCommand: string;
  requiresSudo: boolean;
  safeToAutoKill: boolean;
  isPermanentFix: boolean;
}

export interface PortStatus {
  port: number;
  name?: string;
  source?: string;
  available: boolean;
  blocker?: Blocker;
  warnings: string[];
}

export interface ScanResult {
  ports: PortStatus[];
  hasConflicts: boolean;
  conflictCount: number;
}

export interface PortGuardianConfig {
  ports: Array<{
    port: number;
    name?: string;
  }>;
  detect?: {
    exclude?: string[];
  };
}

export interface DetectOptions {
  cwd?: string;
  verbose?: boolean;
  exclude?: string[];
}

export interface CliOptions {
  force: boolean;
  ci: boolean;
  dryRun: boolean;
  verbose: boolean;
}

export interface OutputContext {
  mode: 'single' | 'multi' | 'auto-detect';
}
