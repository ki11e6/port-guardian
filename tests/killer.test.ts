import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { exec, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { killBlocker } from '../src/killer.js';
import { killPort } from '../src/index.js';
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
    it('should treat already-terminated process as success', async () => {
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

      // Process already gone = port is free = success
      expect(result.success).toBe(true);
    });

    it('should return error for invalid PID (negative)', async () => {
      const blocker: Blocker = {
        type: 'native',
        pid: -1,
        processName: 'fake-process',
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill -1',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result = await killBlocker(blocker, { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid PID');
    });

    it('should return error for invalid PID (zero)', async () => {
      const blocker: Blocker = {
        type: 'native',
        pid: 0,
        processName: 'fake-process',
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'kill-process',
        suggestedCommand: 'kill 0',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result = await killBlocker(blocker, { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid PID');
    });
  });

  describe('killBlocker - command injection protection', () => {
    it('should reject container names with shell metacharacters', async () => {
      const blocker: Blocker = {
        type: 'docker-container',
        pid: 1234,
        processName: 'docker-proxy',
        docker: {
          containerName: 'test; rm -rf /',
          containerId: 'abc123',
          image: 'nginx',
          state: 'running',
          restartPolicy: 'no',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'stop-container',
        suggestedCommand: 'docker stop "test; rm -rf /"',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result = await killBlocker(blocker, { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid container name');
    });

    it('should reject container names with backticks', async () => {
      const blocker: Blocker = {
        type: 'docker-container',
        pid: 1234,
        processName: 'docker-proxy',
        docker: {
          containerName: 'test`whoami`',
          containerId: 'abc123',
          image: 'nginx',
          state: 'running',
          restartPolicy: 'no',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'stop-container',
        suggestedCommand: 'docker stop test`whoami`',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      const result = await killBlocker(blocker, { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid container name');
    });

    it('should accept valid container names with dots and dashes', async () => {
      // This test only checks the validation passes, not actual container stop
      const blocker: Blocker = {
        type: 'docker-container',
        pid: 1234,
        processName: 'docker-proxy',
        docker: {
          containerName: 'my-app_db.backup-2024',
          containerId: 'abc123',
          image: 'nginx',
          state: 'running',
          restartPolicy: 'no',
        },
        isOrphanedDockerProxy: false,
        hasRestartLoop: false,
        suggestedAction: 'stop-container',
        suggestedCommand: 'docker stop my-app_db.backup-2024',
        requiresSudo: false,
        safeToAutoKill: false,
        isPermanentFix: true,
      };

      // Will fail because container doesn't exist, but should not fail on validation
      const result = await killBlocker(blocker, { dryRun: false });

      // Error should NOT be about invalid container name
      if (!result.success) {
        expect(result.error).not.toContain('Invalid container name');
      }
    });
  });
});

describe('killPort', () => {
  it('should return wasAvailable when port is already free', async () => {
    const result = await killPort(59850);

    expect(result.port).toBe(59850);
    expect(result.killed).toBe(false);
    expect(result.wasAvailable).toBe(true);
    expect(result.blocker).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('should return blocker info in dry-run mode without killing', async () => {
    // Bind a port so there's something to find
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(59851, '127.0.0.1', resolve));

    try {
      const result = await killPort(59851, { dryRun: true });

      expect(result.port).toBe(59851);
      expect(result.killed).toBe(true); // dry-run reports success
      expect(result.wasAvailable).toBe(false);
      expect(result.blocker).toBeDefined();
      expect(result.blocker?.pid).toBeGreaterThan(0);
      expect(result.command).toBeDefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('should kill a process occupying a port', async () => {
    const child = spawn(process.execPath, ['-e', `
      const net = require('net');
      const server = net.createServer();
      server.listen(59852, '127.0.0.1', () => {
        process.stdout.write('READY\\n');
      });
      setInterval(() => {}, 60000);
    `], { stdio: ['pipe', 'pipe', 'pipe'] });

    try {
      // Wait for READY signal
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Child process did not become ready')), 5000);
        child.stdout!.on('data', (data: Buffer) => {
          if (data.toString().includes('READY')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.on('error', (err) => { clearTimeout(timeout); reject(err); });
        child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Child exited early with code ${code}`)); });
      });

      const result = await killPort(59852);

      expect(result.port).toBe(59852);
      expect(result.wasAvailable).toBe(false);
      expect(result.killed).toBe(true);
      expect(result.blocker).toBeDefined();
      expect(result.blocker?.pid).toBe(child.pid);
      expect(result.command).toBeDefined();
    } finally {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }
  });

  it('should throw on invalid port number', async () => {
    await expect(killPort(0)).rejects.toThrow('Invalid port: 0');
    await expect(killPort(-1)).rejects.toThrow('Invalid port: -1');
    await expect(killPort(70000)).rejects.toThrow('Invalid port: 70000');
    await expect(killPort(3.5)).rejects.toThrow('Invalid port: 3.5');
  });

  it('should support JSON-friendly output shape', async () => {
    const result = await killPort(59853);

    // Verify the shape is JSON-serializable
    const json = JSON.parse(JSON.stringify(result));
    expect(json).toHaveProperty('port');
    expect(json).toHaveProperty('killed');
    expect(json).toHaveProperty('wasAvailable');
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

    it('should stop a Docker container', async (ctx) => {
      if (!dockerAvailable || !testContainerId) {
        ctx.skip();
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

    it('should stop and remove a Docker container', async (ctx) => {
      if (!dockerAvailable) {
        ctx.skip();
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
