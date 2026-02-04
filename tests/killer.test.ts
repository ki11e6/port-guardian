import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { killBlocker } from '../src/killer.js';
import { isDockerAvailable } from '../src/resolver.js';
import type { Blocker } from '../src/types.js';

const execAsync = promisify(exec);

describe('killer', () => {
  describe('killBlocker - dry run', () => {
    it('should return success without executing in dry run mode', async () => {
      const blocker: Blocker = {
        type: 'native',
        pid: 99999,
        processName: 'test-process',
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill 99999',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result = await killBlocker(blocker, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.action).toBe('kill-process');
      expect(result.command).toBe('kill 99999');
    });

    it('should return correct command for stop-container action', async () => {
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

      const result = await killBlocker(blocker, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.action).toBe('stop-container');
      expect(result.command).toBe('docker stop test-container');
    });

    it('should return correct command for stop-and-remove action', async () => {
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

      const result = await killBlocker(blocker, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.action).toBe('stop-and-remove');
      expect(result.command).toContain('docker stop');
      expect(result.command).toContain('docker rm');
    });
  });

  describe('killBlocker - error handling', () => {
    it('should return error for non-existent process', async () => {
      const blocker: Blocker = {
        type: 'native',
        pid: 999999999, // Non-existent PID
        processName: 'fake-process',
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill 999999999',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result = await killBlocker(blocker, { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe('killer - Docker integration', () => {
  let dockerAvailable = false;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
  });

  describe('killBlocker - stop container', () => {
    const testPort = 59600;
    let testContainerId: string | null = null;

    beforeEach(async () => {
      if (!dockerAvailable) return;

      // Create a fresh container for each test
      try {
        await execAsync(`docker rm -f test-killer-${testPort} 2>/dev/null`).catch(() => {});
        const { stdout } = await execAsync(
          `docker run -d --name test-killer-${testPort} -p ${testPort}:80 nginx:alpine 2>/dev/null`
        );
        testContainerId = stdout.trim();
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        testContainerId = null;
      }
    });

    afterAll(async () => {
      if (dockerAvailable) {
        try {
          await execAsync(`docker rm -f test-killer-${testPort} 2>/dev/null`);
        } catch {
          // Ignore
        }
      }
    });

    it('should stop a Docker container', async () => {
      if (!dockerAvailable || !testContainerId) {
        console.log('Skipping Docker test');
        return;
      }

      const blocker: Blocker = {
        type: 'docker-container',
        pid: 1234,
        processName: 'docker-proxy',
        docker: {
          containerName: `test-killer-${testPort}`,
          containerId: testContainerId,
          image: 'nginx:alpine',
          state: 'running',
          restartPolicy: 'no',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'stop-container',
        suggestedCommand: `docker stop test-killer-${testPort}`,
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result = await killBlocker(blocker);

      expect(result.success).toBe(true);

      // Verify container is stopped
      const { stdout } = await execAsync(
        `docker ps -a --filter "name=test-killer-${testPort}" --format "{{.Status}}"`
      );
      expect(stdout).toContain('Exited');
    });
  });

  describe('killBlocker - stop and remove container', () => {
    const testPort = 59601;

    beforeEach(async () => {
      if (!dockerAvailable) return;

      try {
        await execAsync(`docker rm -f test-killer-rm-${testPort} 2>/dev/null`).catch(() => {});
        await execAsync(
          `docker run -d --name test-killer-rm-${testPort} --restart=always -p ${testPort}:80 nginx:alpine 2>/dev/null`
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        // Ignore
      }
    });

    afterAll(async () => {
      if (dockerAvailable) {
        try {
          await execAsync(`docker rm -f test-killer-rm-${testPort} 2>/dev/null`);
        } catch {
          // Ignore
        }
      }
    });

    it('should stop and remove a Docker container', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test');
        return;
      }

      const blocker: Blocker = {
        type: 'docker-container',
        pid: 1234,
        processName: 'docker-proxy',
        docker: {
          containerName: `test-killer-rm-${testPort}`,
          containerId: 'abc123',
          image: 'nginx:alpine',
          state: 'running',
          restartPolicy: 'always',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'stop-and-remove',
        suggestedCommand: `docker stop test-killer-rm-${testPort} && docker rm test-killer-rm-${testPort}`,
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result = await killBlocker(blocker);

      expect(result.success).toBe(true);

      // Verify container is gone
      const { stdout } = await execAsync(
        `docker ps -a --filter "name=test-killer-rm-${testPort}" --format "{{.Names}}"`
      );
      expect(stdout.trim()).toBe('');
    });
  });
});
