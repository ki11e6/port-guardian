import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scan } from '../src/index.js';

describe('index - programmatic API', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `port-guardian-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('scan', () => {
    it('should return empty result when no ports specified and no config', async () => {
      const result = await scan({ cwd: testDir });

      expect(result.ports).toHaveLength(0);
      expect(result.hasConflicts).toBe(false);
      expect(result.conflictCount).toBe(0);
    });

    it('should scan explicit ports', async () => {
      const result = await scan({ ports: [59990, 59991, 59992] });

      expect(result.ports).toHaveLength(3);
      expect(result.ports.every((p) => p.available)).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.conflictCount).toBe(0);
    });

    it('should detect ports from config file', async () => {
      const config = `
ports:
  - port: 59980
    name: Test Port 1
  - port: 59981
    name: Test Port 2
`;
      await writeFile(join(testDir, '.portguardian.yml'), config);

      const result = await scan({ cwd: testDir });

      expect(result.ports).toHaveLength(2);
      expect(result.ports[0].port).toBe(59980);
      expect(result.ports[1].port).toBe(59981);
    });

    it('should report conflicts correctly', async (ctx) => {
      // Find a port that's actually in use
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      let usedPort: number | null = null;
      try {
        const { stdout } = await execAsync(
          "lsof -i -P -n | grep LISTEN | head -1 | awk '{print $9}' | cut -d: -f2"
        );
        usedPort = parseInt(stdout.trim(), 10);
      } catch {
        // No ports in use
      }

      if (!usedPort || isNaN(usedPort)) {
        ctx.skip();
        return;
      }

      const result = await scan({ ports: [usedPort, 59999] });

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictCount).toBe(1);
      expect(result.ports.find((p) => p.port === usedPort)?.available).toBe(false);
      expect(result.ports.find((p) => p.port === 59999)?.available).toBe(true);
    });

    it('should include blocker info for blocked ports', async (ctx) => {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      let usedPort: number | null = null;
      try {
        const { stdout } = await execAsync(
          "lsof -i -P -n | grep LISTEN | head -1 | awk '{print $9}' | cut -d: -f2"
        );
        usedPort = parseInt(stdout.trim(), 10);
      } catch {
        // No ports in use
      }

      if (!usedPort || isNaN(usedPort)) {
        ctx.skip();
        return;
      }

      const result = await scan({ ports: [usedPort] });

      const blockedPort = result.ports.find((p) => !p.available);
      expect(blockedPort).toBeDefined();
      expect(blockedPort?.blocker).toBeDefined();
      expect(blockedPort?.blocker?.pid).toBeGreaterThan(0);
    });
  });
});

describe('index - exports', () => {
  it('should export all expected functions', async () => {
    const exports = await import('../src/index.js');

    expect(typeof exports.scan).toBe('function');
    expect(typeof exports.killPort).toBe('function');
    expect(typeof exports.detectPorts).toBe('function');
    expect(typeof exports.checkPort).toBe('function');
    expect(typeof exports.checkPorts).toBe('function');
    expect(typeof exports.findAvailablePort).toBe('function');
  });

  it('should not export internal functions', async () => {
    const exports = await import('../src/index.js') as Record<string, unknown>;

    expect(exports.resolveBlocker).toBeUndefined();
    expect(exports.generateWarnings).toBeUndefined();
    expect(exports.isDockerAvailable).toBeUndefined();
    expect(exports.killBlocker).toBeUndefined();
  });
});
