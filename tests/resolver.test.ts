import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  isDockerAvailable,
  findContainerByPort,
  resolveBlocker,
  generateWarnings,
} from '../src/resolver.js';
import type { ProcessInfo, Blocker } from '../src/types.js';

const execAsync = promisify(exec);

describe('resolver', () => {
  describe('isDockerAvailable', () => {
    it('should return boolean indicating Docker availability', async () => {
      const result = await isDockerAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('resolveBlocker - native process', () => {
    it('should resolve native process blocker', async () => {
      const process: ProcessInfo = {
        pid: 1234,
        command: 'node',
        user: 'testuser',
        args: 'server.js',
      };

      const blocker = await resolveBlocker(process, 3000);

      expect(blocker.type).toBe('native');
      expect(blocker.pid).toBe(1234);
      expect(blocker.processName).toBe('node');
      expect(blocker.isOrphanedDockerProxy).toBe(false);
      expect(blocker.hasRestartLoop).toBe(false);
      expect(blocker.suggestedAction).toBe('kill-process');
      expect(blocker.suggestedCommand).toBe('kill 1234');
      expect(blocker.isPermanentFix).toBe(true);
    });

    it('should set requiresSudo for root-owned process', async () => {
      const process: ProcessInfo = {
        pid: 1234,
        command: 'nginx',
        user: 'root',
      };

      const blocker = await resolveBlocker(process, 80);

      expect(blocker.requiresSudo).toBe(true);
    });

    it('should not set requiresSudo for user-owned process', async () => {
      const process: ProcessInfo = {
        pid: 1234,
        command: 'node',
        user: 'testuser',
      };

      const blocker = await resolveBlocker(process, 3000);

      expect(blocker.requiresSudo).toBe(false);
    });
  });

  describe('generateWarnings', () => {
    it('should generate warning for orphaned docker-proxy', () => {
      const blocker: Blocker = {
        type: 'orphaned-docker-proxy',
        pid: 1234,
        processName: 'docker-proxy',
        isOrphanedDockerProxy: true,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill 1234',
        requiresSudo: true,
        safeToAutoKill: true,
        isPermanentFix: true,
      };

      const warnings = generateWarnings(blocker);

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes('Orphaned'))).toBe(true);
      expect(warnings.some((w) => w.includes('safe to kill'))).toBe(true);
    });

    it('should generate warning for restart loop', () => {
      const blocker: Blocker = {
        type: 'docker-container',
        pid: 1234,
        processName: 'docker-proxy',
        docker: {
          containerName: 'test-container',
          containerId: 'abc123',
          image: 'nginx',
          state: 'exited',
          restartPolicy: 'always',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: true,
        suggestedAction: 'stop-and-remove',
        suggestedCommand: 'docker stop test-container && docker rm test-container',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const warnings = generateWarnings(blocker);

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes('restart loop'))).toBe(true);
    });

    it('should generate warning for restart:always policy', () => {
      const blocker: Blocker = {
        type: 'docker-container',
        pid: 1234,
        processName: 'docker-proxy',
        docker: {
          containerName: 'test-container',
          containerId: 'abc123',
          image: 'nginx',
          state: 'running',
          restartPolicy: 'always',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'stop-and-remove',
        suggestedCommand: 'docker stop test-container && docker rm test-container',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const warnings = generateWarnings(blocker);

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes('restart:always'))).toBe(true);
      expect(warnings.some((w) => w.includes('auto-restart'))).toBe(true);
    });

    it('should generate warning for sudo requirement', () => {
      const blocker: Blocker = {
        type: 'native',
        pid: 1234,
        processName: 'nginx',
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill 1234',
        requiresSudo: true,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const warnings = generateWarnings(blocker);

      expect(warnings.some((w) => w.toLowerCase().includes('sudo') || w.toLowerCase().includes('root'))).toBe(true);
    });

    it('should return empty array for simple blocker without issues', () => {
      const blocker: Blocker = {
        type: 'docker-container',
        pid: 1234,
        processName: 'docker-proxy',
        docker: {
          containerName: 'test-container',
          containerId: 'abc123',
          image: 'nginx',
          state: 'running',
          restartPolicy: 'no',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'stop-container',
        suggestedCommand: 'docker stop test-container',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const warnings = generateWarnings(blocker);

      expect(warnings).toHaveLength(0);
    });
  });
});

describe('resolver - Docker integration', () => {
  let dockerAvailable = false;
  let testContainerId: string | null = null;
  const testPort = 59700;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();

    if (dockerAvailable) {
      try {
        const { stdout } = await execAsync(
          `docker run -d --name test-resolver-${testPort} --restart=always -p ${testPort}:80 nginx:alpine 2>/dev/null`
        );
        testContainerId = stdout.trim();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        testContainerId = null;
      }
    }
  });

  afterAll(async () => {
    if (testContainerId) {
      try {
        await execAsync(`docker stop test-resolver-${testPort} 2>/dev/null`);
        await execAsync(`docker rm test-resolver-${testPort} 2>/dev/null`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('findContainerByPort', () => {
    it('should find container by port', async () => {
      if (!dockerAvailable || !testContainerId) {
        console.log('Skipping Docker test');
        return;
      }

      const result = await findContainerByPort(testPort);

      expect(result).not.toBeNull();
      expect(result?.containerName).toBe(`test-resolver-${testPort}`);
      expect(result?.restartPolicy).toBe('always');
    });

    it('should return null for unused port', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test');
        return;
      }

      const result = await findContainerByPort(59999);

      expect(result).toBeNull();
    });
  });

  describe('resolveBlocker - docker-proxy', () => {
    it('should resolve docker-proxy to container with restart policy', async () => {
      if (!dockerAvailable || !testContainerId) {
        console.log('Skipping Docker test');
        return;
      }

      const process: ProcessInfo = {
        pid: 1234,
        command: 'docker-proxy',
        user: 'root',
      };

      const blocker = await resolveBlocker(process, testPort);

      expect(blocker.type).toBe('docker-container');
      expect(blocker.docker).toBeDefined();
      expect(blocker.docker?.containerName).toBe(`test-resolver-${testPort}`);
      expect(blocker.docker?.restartPolicy).toBe('always');
      expect(blocker.suggestedAction).toBe('stop-and-remove');
      expect(blocker.suggestedCommand).toContain('docker stop');
      expect(blocker.suggestedCommand).toContain('docker rm');
    });
  });
});
