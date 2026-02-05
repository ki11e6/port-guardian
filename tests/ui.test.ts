import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PortStatus, ScanResult, PortSource, Blocker } from '../src/types.js';
import type { KillPortResult } from '../src/index.js';

// Mock console.log to capture output
let consoleOutput: string[] = [];
const originalConsoleLog = console.log;

beforeEach(() => {
  consoleOutput = [];
  console.log = (...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  console.log = originalConsoleLog;
});

describe('ui', () => {
  describe('printHeader', () => {
    it('should print header with title', async () => {
      const { printHeader } = await import('../src/ui.js');

      printHeader();

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port Guardian');
    });
  });

  describe('printDetectedPorts', () => {
    it('should print message when no ports detected', async () => {
      const { printDetectedPorts } = await import('../src/ui.js');

      printDetectedPorts([]);

      const output = consoleOutput.join('\n');
      expect(output).toContain('No ports detected');
    });

    it('should print port table when ports detected', async () => {
      const { printDetectedPorts } = await import('../src/ui.js');

      const sources: PortSource[] = [
        { port: 3000, name: 'API', source: 'docker-compose.yml', confidence: 95 },
        { port: 4200, name: 'Frontend', source: '.portguardian.yml', confidence: 100 },
      ];

      printDetectedPorts(sources);

      const output = consoleOutput.join('\n');
      expect(output).toContain('3000');
      expect(output).toContain('4200');
      expect(output).toContain('API');
      expect(output).toContain('Frontend');
    });
  });

  describe('printScanResults', () => {
    it('should print available ports with checkmark', async () => {
      const { printScanResults } = await import('../src/ui.js');

      const result: ScanResult = {
        ports: [
          { port: 3000, available: true, warnings: [] },
        ],
        hasConflicts: false,
        conflictCount: 0,
      };

      printScanResults(result);

      const output = consoleOutput.join('\n');
      expect(output).toContain('3000');
      expect(output).toContain('Available');
    });

    it('should print blocked ports with X', async () => {
      const { printScanResults } = await import('../src/ui.js');

      const blocker: Blocker = {
        type: 'native',
        pid: 1234,
        processName: 'node',
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill 1234',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result: ScanResult = {
        ports: [
          { port: 3000, available: false, blocker, warnings: [] },
        ],
        hasConflicts: true,
        conflictCount: 1,
      };

      printScanResults(result);

      const output = consoleOutput.join('\n');
      expect(output).toContain('3000');
      expect(output).toContain('BLOCKED');
      expect(output).toContain('node');
      expect(output).toContain('1234');
    });

    it('should print Docker container details', async () => {
      const { printScanResults } = await import('../src/ui.js');

      const blocker: Blocker = {
        type: 'docker-container',
        pid: 5678,
        processName: 'docker-proxy',
        docker: {
          containerName: 'my-app-db',
          containerId: 'abc123',
          image: 'postgres:14',
          state: 'running',
          composeProject: 'my-app',
          restartPolicy: 'always',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'stop-and-remove',
        suggestedCommand: 'docker stop my-app-db && docker rm my-app-db',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result: ScanResult = {
        ports: [
          { port: 5432, available: false, blocker, warnings: ['Test warning'] },
        ],
        hasConflicts: true,
        conflictCount: 1,
      };

      printScanResults(result);

      const output = consoleOutput.join('\n');
      expect(output).toContain('5432');
      expect(output).toContain('my-app-db');
      expect(output).toContain('my-app');
      expect(output).toContain('running');
      expect(output).toContain('always');
    });

    it('should print warnings', async () => {
      const { printScanResults } = await import('../src/ui.js');

      const blocker: Blocker = {
        type: 'native',
        pid: 1234,
        processName: 'node',
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill 1234',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result: ScanResult = {
        ports: [
          {
            port: 3000,
            available: false,
            blocker,
            warnings: ['This is a test warning']
          },
        ],
        hasConflicts: true,
        conflictCount: 1,
      };

      printScanResults(result);

      const output = consoleOutput.join('\n');
      expect(output).toContain('test warning');
    });
  });

  describe('printRestartWarning', () => {
    it('should print warning box', async () => {
      const { printRestartWarning } = await import('../src/ui.js');

      printRestartWarning();

      const output = consoleOutput.join('\n');
      expect(output).toContain('WARNING');
      expect(output).toContain('restart:always');
    });
  });

  describe('printSuccess', () => {
    it('should print success message', async () => {
      const { printSuccess } = await import('../src/ui.js');

      printSuccess('Operation completed');

      const output = consoleOutput.join('\n');
      expect(output).toContain('Operation completed');
    });
  });

  describe('printError', () => {
    it('should print error message', async () => {
      const { printError } = await import('../src/ui.js');

      printError('Something went wrong');

      const output = consoleOutput.join('\n');
      expect(output).toContain('Something went wrong');
    });
  });

  describe('printInfo', () => {
    it('should print info message', async () => {
      const { printInfo } = await import('../src/ui.js');

      printInfo('Information message');

      const output = consoleOutput.join('\n');
      expect(output).toContain('Information message');
    });
  });

  describe('printSummary', () => {
    it('should print summary with counts', async () => {
      const { printSummary } = await import('../src/ui.js');

      const result: ScanResult = {
        ports: [
          { port: 3000, available: true, warnings: [] },
          { port: 4000, available: true, warnings: [] },
          { port: 5000, available: false, warnings: [] },
        ],
        hasConflicts: true,
        conflictCount: 1,
      };

      printSummary(result);

      const output = consoleOutput.join('\n');
      expect(output).toContain('2 available');
      expect(output).toContain('1 blocked');
    });
  });

  describe('printCompactResult', () => {
    it('should print single line for available port', async () => {
      const { printCompactResult } = await import('../src/ui.js');

      printCompactResult({ port: 3000, available: true, warnings: [] });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port 3000 available');
      expect(output).not.toContain('Port Status:');
    });

    it('should print compact blocked output without duplicating process info', async () => {
      const { printCompactResult } = await import('../src/ui.js');

      const blocker: Blocker = {
        type: 'native',
        pid: 1234,
        processName: 'node',
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill 1234',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      printCompactResult({ port: 3000, available: false, blocker, warnings: [] });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port 3000 blocked by node (PID 1234)');
      // Should NOT duplicate process info via printBlockerDetails
      expect(output).not.toContain('Process:');
    });
  });

  describe('printKillResult', () => {
    it('should print already available', async () => {
      const { printKillResult } = await import('../src/ui.js');

      const r: KillPortResult = { port: 3000, killed: false, wasAvailable: true };
      printKillResult(r, false);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port 3000 already available');
    });

    it('should print killed', async () => {
      const { printKillResult } = await import('../src/ui.js');

      const r: KillPortResult = {
        port: 3000, killed: true, wasAvailable: false,
        blocker: { pid: 1234, process: 'node', type: 'native' },
        command: 'kill 1234',
      };
      printKillResult(r, false);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port 3000: killed node (PID 1234)');
    });

    it('should print dry-run', async () => {
      const { printKillResult } = await import('../src/ui.js');

      const r: KillPortResult = {
        port: 3000, killed: true, wasAvailable: false,
        blocker: { pid: 1234, process: 'node', type: 'native' },
        command: 'kill 1234',
      };
      printKillResult(r, true);

      const output = consoleOutput.join('\n');
      expect(output).toContain('would kill');
      expect(output).toContain('(dry-run)');
    });

    it('should print failed', async () => {
      const { printKillResult } = await import('../src/ui.js');

      const r: KillPortResult = {
        port: 3000, killed: false, wasAvailable: false, error: 'permission denied',
      };
      printKillResult(r, false);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port 3000: failed - permission denied');
    });
  });

  describe('printScanOutput', () => {
    it('should use compact output for single mode', async () => {
      const { printScanOutput } = await import('../src/ui.js');

      const result: ScanResult = {
        ports: [{ port: 3000, available: true, warnings: [] }],
        hasConflicts: false,
        conflictCount: 0,
      };

      printScanOutput(result, { mode: 'single' });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port 3000 available');
      expect(output).not.toContain('Port Status:');
      expect(output).not.toContain('Summary:');
    });

    it('should show all-available message for multi mode', async () => {
      const { printScanOutput } = await import('../src/ui.js');

      const result: ScanResult = {
        ports: [
          { port: 3000, available: true, warnings: [] },
          { port: 8080, available: true, warnings: [] },
        ],
        hasConflicts: false,
        conflictCount: 0,
      };

      printScanOutput(result, { mode: 'multi' });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port Status:');
      expect(output).toContain('All 2 ports available');
      expect(output).not.toContain('Summary:');
    });

    it('should show summary for multi mode with conflicts', async () => {
      const { printScanOutput } = await import('../src/ui.js');

      const blocker: Blocker = {
        type: 'native', pid: 1234, processName: 'node',
        isOrphanedDockerProxy: false, hasRestartLoop: false,
        suggestedAction: 'kill-process', suggestedCommand: 'kill 1234',
        requiresSudo: false, safeToAutoKill: false, isPermanentFix: true,
      };

      const result: ScanResult = {
        ports: [
          { port: 3000, available: true, warnings: [] },
          { port: 8080, available: false, blocker, warnings: [] },
        ],
        hasConflicts: true,
        conflictCount: 1,
      };

      printScanOutput(result, { mode: 'multi' });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port Status:');
      expect(output).toContain('Summary:');
      expect(output).toContain('1 available');
      expect(output).toContain('1 blocked');
    });

    it('should use compact output for single blocked port', async () => {
      const { printScanOutput } = await import('../src/ui.js');

      const blocker: Blocker = {
        type: 'native', pid: 1234, processName: 'node',
        isOrphanedDockerProxy: false, hasRestartLoop: false,
        suggestedAction: 'kill-process', suggestedCommand: 'kill 1234',
        requiresSudo: false, safeToAutoKill: false, isPermanentFix: true,
      };

      const result: ScanResult = {
        ports: [{ port: 3000, available: false, blocker, warnings: [] }],
        hasConflicts: true,
        conflictCount: 1,
      };

      printScanOutput(result, { mode: 'single' });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port 3000 blocked by node (PID 1234)');
      expect(output).not.toContain('Port Status:');
    });

    it('should show summary for auto-detect mode with conflicts', async () => {
      const { printScanOutput } = await import('../src/ui.js');

      const blocker: Blocker = {
        type: 'native', pid: 5678, processName: 'python',
        isOrphanedDockerProxy: false, hasRestartLoop: false,
        suggestedAction: 'kill-process', suggestedCommand: 'kill 5678',
        requiresSudo: false, safeToAutoKill: false, isPermanentFix: true,
      };

      const result: ScanResult = {
        ports: [
          { port: 3000, available: true, warnings: [] },
          { port: 8080, available: false, blocker, warnings: [] },
        ],
        hasConflicts: true,
        conflictCount: 1,
      };

      printScanOutput(result, { mode: 'auto-detect' });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port Status:');
      expect(output).toContain('Summary:');
      expect(output).toContain('1 available');
      expect(output).toContain('1 blocked');
      expect(output).not.toContain('All ports are available!');
    });

    it('should show full output with summary for auto-detect mode', async () => {
      const { printScanOutput } = await import('../src/ui.js');

      const result: ScanResult = {
        ports: [
          { port: 3000, available: true, warnings: [] },
          { port: 8080, available: true, warnings: [] },
        ],
        hasConflicts: false,
        conflictCount: 0,
      };

      printScanOutput(result, { mode: 'auto-detect' });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Port Status:');
      expect(output).toContain('Summary:');
      expect(output).toContain('All ports are available!');
    });
  });
});
