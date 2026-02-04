import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPorts } from '../src/detector.js';

describe('detector', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `port-guardian-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('detectFromPortGuardianYml', () => {
    it('should detect ports from .portguardian.yml', async () => {
      const config = `
ports:
  - port: 3000
    name: API Server
  - port: 4200
    name: Frontend
`;
      await writeFile(join(testDir, '.portguardian.yml'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports[0]).toMatchObject({
        port: 3000,
        name: 'API Server',
        source: '.portguardian.yml',
        confidence: 100,
      });
      expect(ports[1]).toMatchObject({
        port: 4200,
        name: 'Frontend',
        source: '.portguardian.yml',
        confidence: 100,
      });
    });

    it('should handle .portguardian.yml without names', async () => {
      const config = `
ports:
  - port: 8080
  - port: 9090
`;
      await writeFile(join(testDir, '.portguardian.yml'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports[0].port).toBe(8080);
      expect(ports[1].port).toBe(9090);
    });
  });

  describe('detectFromPackageJson', () => {
    it('should detect ports from package.json portGuardian config', async () => {
      const pkg = {
        name: 'test-project',
        portGuardian: {
          ports: [
            { port: 3000, name: 'Dev Server' },
            { port: 5432, name: 'PostgreSQL' },
          ],
        },
      };
      await writeFile(join(testDir, 'package.json'), JSON.stringify(pkg, null, 2));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports[0]).toMatchObject({
        port: 3000,
        name: 'Dev Server',
        source: 'package.json',
        confidence: 100,
      });
    });

    it('should ignore package.json without portGuardian config', async () => {
      const pkg = {
        name: 'test-project',
        version: '1.0.0',
      };
      await writeFile(join(testDir, 'package.json'), JSON.stringify(pkg, null, 2));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(0);
    });
  });

  describe('detectFromDockerCompose', () => {
    it('should detect ports from docker-compose.yml', async () => {
      const compose = `
version: '3.8'
services:
  web:
    image: nginx
    ports:
      - "8080:80"
  db:
    image: postgres
    ports:
      - "5432:5432"
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.find((p) => p.port === 8080)).toMatchObject({
        port: 8080,
        name: 'web',
        source: 'docker-compose.yml',
        confidence: 95,
      });
      expect(ports.find((p) => p.port === 5432)).toMatchObject({
        port: 5432,
        name: 'db',
        source: 'docker-compose.yml',
        confidence: 95,
      });
    });

    it('should handle compose.yml (alternate name)', async () => {
      const compose = `
version: '3'
services:
  app:
    image: node
    ports:
      - "3000:3000"
`;
      await writeFile(join(testDir, 'compose.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
      expect(ports[0].source).toBe('compose.yml');
    });

    it('should handle various port mapping formats', async () => {
      const compose = `
version: '3'
services:
  svc1:
    ports:
      - "3000"
  svc2:
    ports:
      - "3001:80"
  svc3:
    ports:
      - "127.0.0.1:3002:80"
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(3);
      expect(ports.map((p) => p.port).sort()).toEqual([3000, 3001, 3002]);
    });

    it('should handle numeric ports', async () => {
      const compose = `
version: '3'
services:
  app:
    ports:
      - 8000
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(8000);
    });
  });

  describe('priority and deduplication', () => {
    it('should prioritize .portguardian.yml over docker-compose.yml', async () => {
      const guardianConfig = `
ports:
  - port: 3000
    name: Custom Name
`;
      const compose = `
version: '3'
services:
  web:
    ports:
      - "3000:80"
`;
      await writeFile(join(testDir, '.portguardian.yml'), guardianConfig);
      await writeFile(join(testDir, 'docker-compose.yml'), compose);

      const ports = await detectPorts(testDir);

      // Should only have one entry for port 3000, from .portguardian.yml
      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3000,
        name: 'Custom Name',
        source: '.portguardian.yml',
        confidence: 100,
      });
    });
  });

  describe('empty and invalid configs', () => {
    it('should return empty array when no config files exist', async () => {
      const ports = await detectPorts(testDir);
      expect(ports).toHaveLength(0);
    });

    it('should handle empty .portguardian.yml', async () => {
      await writeFile(join(testDir, '.portguardian.yml'), '');
      const ports = await detectPorts(testDir);
      expect(ports).toHaveLength(0);
    });

    it('should handle malformed YAML gracefully', async () => {
      await writeFile(join(testDir, '.portguardian.yml'), 'this is not valid yaml: [');
      const ports = await detectPorts(testDir);
      expect(ports).toHaveLength(0);
    });

    it('should handle docker-compose without services', async () => {
      await writeFile(join(testDir, 'docker-compose.yml'), 'version: "3"');
      const ports = await detectPorts(testDir);
      expect(ports).toHaveLength(0);
    });
  });
});
