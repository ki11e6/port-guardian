import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { checkPort, checkPorts, findAvailablePort } from '../src/scanner.js';

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

describe('findAvailablePort', () => {
  it('should return the base port when it is available', async () => {
    const port = await findAvailablePort(59950);
    expect(port).toBe(59950);
  });

  it('should skip occupied ports and return the next available', async () => {
    // Bind a port so findAvailablePort has to skip it
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(59960, '127.0.0.1', resolve));

    try {
      const port = await findAvailablePort(59960);
      expect(port).toBe(59961);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('should return a valid ephemeral port when no base port is given', async () => {
    const port = await findAvailablePort();
    expect(port).toBeGreaterThanOrEqual(49152);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it('should throw when no port is available within maxAttempts', async () => {
    // Use maxAttempts=1 on a port we know is in use
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(59970, '127.0.0.1', resolve));

    try {
      await expect(findAvailablePort(59970, 1)).rejects.toThrow(
        'No available port found after 1 attempts'
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('should throw on invalid base port', async () => {
    await expect(findAvailablePort(0)).rejects.toThrow('Invalid port: 0');
    await expect(findAvailablePort(-1)).rejects.toThrow('Invalid port: -1');
    await expect(findAvailablePort(70000)).rejects.toThrow('Invalid port: 70000');
    await expect(findAvailablePort(3.5)).rejects.toThrow('Invalid port: 3.5');
  });

  it('should stop before exceeding port 65535', async () => {
    // Start from a high port - should not throw even if it runs out of range
    // (it throws the generic "no port found" error, not an out-of-range crash)
    await expect(findAvailablePort(65535, 5)).resolves.toBe(65535);
  });
});

describe('scanner - Docker detection', () => {
  let dockerAvailable = false;
  let testContainerId: string | null = null;
  const testPort = 59800;

  beforeAll(async () => {
    // Check if Docker is available (with timeout to avoid hanging on CI)
    try {
      await execAsync('docker info >/dev/null 2>&1', { timeout: 5000 });
      dockerAvailable = true;
    } catch {
      dockerAvailable = false;
    }

    if (dockerAvailable) {
      // Start a test container
      try {
        const { stdout } = await execAsync(
          `docker run -d --name test-scanner-${testPort} -p ${testPort}:80 nginx:alpine 2>/dev/null`,
          { timeout: 15000 }
        );
        testContainerId = stdout.trim();
        // Wait for container to start
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        testContainerId = null;
      }
    }
  }, 30000);

  afterAll(async () => {
    if (testContainerId) {
      try {
        await execAsync(`docker stop test-scanner-${testPort} 2>/dev/null`, { timeout: 10000 });
        await execAsync(`docker rm test-scanner-${testPort} 2>/dev/null`, { timeout: 5000 });
      } catch {
        // Ignore cleanup errors
      }
    }
  }, 20000);

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
