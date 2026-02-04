import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { checkPort, checkPorts } from '../src/scanner.js';

const execAsync = promisify(exec);

describe('scanner', () => {
  describe('checkPort', () => {
    it('should return available for unused port', async () => {
      // Use a high port that's unlikely to be in use
      const result = await checkPort(59999);
      expect(result.available).toBe(true);
      expect(result.process).toBeUndefined();
    });

    it('should detect a port in use by a native process', async () => {
      // Find a port that's actually in use on the system
      const { stdout } = await execAsync(
        "lsof -i -P -n | grep LISTEN | head -1 | awk '{print $9}' | cut -d: -f2"
      );
      const port = parseInt(stdout.trim(), 10);

      if (isNaN(port)) {
        // No ports in use, skip this test
        console.log('Skipping test: no ports in use');
        return;
      }

      const result = await checkPort(port);
      expect(result.available).toBe(false);
      expect(result.process).toBeDefined();
      expect(result.process?.pid).toBeGreaterThan(0);
      expect(result.process?.command).toBeTruthy();
    });
  });

  describe('checkPorts', () => {
    it('should check multiple ports in parallel', async () => {
      const ports = [59997, 59998, 59999];
      const results = await checkPorts(ports);

      expect(results.size).toBe(3);

      for (const port of ports) {
        const result = results.get(port);
        expect(result).toBeDefined();
        expect(result?.available).toBe(true);
      }
    });

    it('should return a Map with port as key', async () => {
      const ports = [59990, 59991];
      const results = await checkPorts(ports);

      expect(results).toBeInstanceOf(Map);
      expect(results.has(59990)).toBe(true);
      expect(results.has(59991)).toBe(true);
    });
  });
});

describe('scanner - Docker detection', () => {
  let dockerAvailable = false;
  let testContainerId: string | null = null;
  const testPort = 59800;

  beforeAll(async () => {
    // Check if Docker is available
    try {
      await execAsync('docker info >/dev/null 2>&1');
      dockerAvailable = true;
    } catch {
      dockerAvailable = false;
    }

    if (dockerAvailable) {
      // Start a test container
      try {
        const { stdout } = await execAsync(
          `docker run -d --name test-scanner-${testPort} -p ${testPort}:80 nginx:alpine 2>/dev/null`
        );
        testContainerId = stdout.trim();
        // Wait for container to start
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        testContainerId = null;
      }
    }
  });

  afterAll(async () => {
    if (testContainerId) {
      try {
        await execAsync(`docker stop test-scanner-${testPort} 2>/dev/null`);
        await execAsync(`docker rm test-scanner-${testPort} 2>/dev/null`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('should detect Docker container blocking port', async () => {
    if (!dockerAvailable || !testContainerId) {
      console.log('Skipping Docker test: Docker not available or container not started');
      return;
    }

    const result = await checkPort(testPort);

    expect(result.available).toBe(false);
    expect(result.process).toBeDefined();
    expect(result.process?.command).toBe('docker-proxy');
  });
});
