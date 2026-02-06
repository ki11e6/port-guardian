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

    it('should handle ports with protocol suffix', async () => {
      const compose = `
version: '3'
services:
  web:
    ports:
      - "8080:80/tcp"
  udp-svc:
    ports:
      - "5353:53/udp"
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.map((p) => p.port).sort()).toEqual([5353, 8080]);
    });

    it('should handle long syntax port mappings', async () => {
      const compose = `
version: '3.8'
services:
  web:
    ports:
      - target: 80
        published: 8080
        protocol: tcp
  api:
    ports:
      - target: 3000
        published: "3001"
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.find((p) => p.port === 8080)).toBeDefined();
      expect(ports.find((p) => p.port === 3001)).toBeDefined();
    });

    it('should handle long syntax without published port', async () => {
      const compose = `
version: '3.8'
services:
  internal:
    ports:
      - target: 9000
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(9000);
    });

    it('should find non-standard compose filenames like docker-compose.shell.yml', async () => {
      const compose = `
version: '3'
services:
  shell:
    ports:
      - "4000:4000"
`;
      await writeFile(join(testDir, 'docker-compose.shell.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 4000,
        name: 'shell',
        source: 'docker-compose.shell.yml',
        confidence: 95,
      });
    });

    it('should find docker-compose.dev.yaml', async () => {
      const compose = `
version: '3'
services:
  dev-app:
    ports:
      - "5000:5000"
`;
      await writeFile(join(testDir, 'docker-compose.dev.yaml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].source).toBe('docker-compose.dev.yaml');
    });

    it('should aggregate ports from multiple compose files', async () => {
      const compose1 = `
version: '3'
services:
  web:
    ports:
      - "3000:3000"
`;
      const compose2 = `
version: '3'
services:
  api:
    ports:
      - "4000:4000"
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose1);
      await writeFile(join(testDir, 'docker-compose.dev.yml'), compose2);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.map((p) => p.port).sort()).toEqual([3000, 4000]);
    });

    it('should find compose.override.yml', async () => {
      const compose = `
version: '3'
services:
  app:
    ports:
      - "7000:7000"
`;
      await writeFile(join(testDir, 'compose.override.yml'), compose);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(7000);
    });
  });

  describe('detectFromEnvFiles', () => {
    it('should detect PORT= from .env', async () => {
      await writeFile(join(testDir, '.env'), 'PORT=3000\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3000,
        name: 'PORT',
        source: '.env',
        confidence: 85,
      });
    });

    it('should detect *_PORT variables', async () => {
      await writeFile(join(testDir, '.env'), 'DB_PORT=5432\nREDIS_PORT=6379\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.find((p) => p.port === 5432)).toMatchObject({
        port: 5432,
        source: '.env',
        confidence: 80,
      });
      expect(ports.find((p) => p.port === 6379)).toMatchObject({
        port: 6379,
        source: '.env',
        confidence: 80,
      });
    });

    it('should detect ports from localhost URLs', async () => {
      await writeFile(join(testDir, '.env'), 'DATABASE_URL=postgres://localhost:5432/mydb\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 5432,
        source: '.env',
        confidence: 70,
      });
    });

    it('should handle quoted values', async () => {
      await writeFile(join(testDir, '.env'), 'PORT="4000"\nAPI_PORT=\'5000\'\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.find((p) => p.port === 4000)).toBeDefined();
      expect(ports.find((p) => p.port === 5000)).toBeDefined();
    });

    it('should skip comments and empty lines', async () => {
      const env = `
# This is a comment
PORT=3000

# Another comment
`;
      await writeFile(join(testDir, '.env'), env);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });

    it('should handle inline comments', async () => {
      await writeFile(join(testDir, '.env'), 'PORT=3000 # dev server\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });

    it('should not strip # inside quoted values', async () => {
      await writeFile(join(testDir, '.env'), 'DATABASE_URL="postgres://localhost:5432/mydb#pool=5"\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(5432);
    });

    it('should handle unquoted values with hash that is not a port', async () => {
      // PASSWORD=abc#123 should not be detected as a port
      await writeFile(join(testDir, '.env'), 'PASSWORD=abc#123\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(0);
    });

    it('should skip variable references', async () => {
      await writeFile(join(testDir, '.env'), 'PORT=${SOME_PORT}\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(0);
    });

    it('should not detect ports from remote URLs', async () => {
      await writeFile(join(testDir, '.env'), 'API_URL=https://api.example.com:8080/v1\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(0);
    });

    it('should not match keys where PORT is a substring of another word', async () => {
      const env = [
        'PASSPORT_SECRET=12345',
        'TRANSPORT_MODE=8080',
        'EXPORT_PATH=3000',
        'SUPPORT_EMAIL=4000',
        'REPORT_DIR=5000',
      ].join('\n');
      await writeFile(join(testDir, '.env'), env);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(0);
    });

    it('should detect from .env.local', async () => {
      await writeFile(join(testDir, '.env.local'), 'PORT=9000\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 9000,
        source: '.env.local',
      });
    });

    it('should detect 127.0.0.1 URLs', async () => {
      await writeFile(join(testDir, '.env'), 'BACKEND_URL=http://127.0.0.1:8080/api\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(8080);
    });

    it('should detect 0.0.0.0 URLs', async () => {
      await writeFile(join(testDir, '.env'), 'SERVER_URL=http://0.0.0.0:3000\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });
  });

  describe('detectFromNxProjects', () => {
    it('should detect ports from apps/*/project.json', async () => {
      await mkdir(join(testDir, 'apps', 'my-app'), { recursive: true });
      const project = {
        name: 'my-app',
        targets: {
          serve: {
            executor: '@nx/vite:dev-server',
            options: { port: 4200 },
          },
        },
      };
      await writeFile(join(testDir, 'apps', 'my-app', 'project.json'), JSON.stringify(project));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 4200,
        name: 'my-app',
        source: 'apps/my-app/project.json',
        confidence: 90,
      });
    });

    it('should detect ports from packages/*/project.json', async () => {
      await mkdir(join(testDir, 'packages', 'shared-lib'), { recursive: true });
      const project = {
        name: 'shared-lib',
        targets: {
          dev: {
            options: { port: 3100 },
          },
        },
      };
      await writeFile(join(testDir, 'packages', 'shared-lib', 'project.json'), JSON.stringify(project));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3100,
        name: 'shared-lib',
        source: 'packages/shared-lib/project.json',
        confidence: 90,
      });
    });

    it('should use directory name when project has no name field', async () => {
      await mkdir(join(testDir, 'apps', 'unnamed-app'), { recursive: true });
      const project = {
        targets: {
          serve: {
            options: { port: 5500 },
          },
        },
      };
      await writeFile(join(testDir, 'apps', 'unnamed-app', 'project.json'), JSON.stringify(project));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].name).toBe('unnamed-app');
    });

    it('should detect ports from angular.json', async () => {
      const angularConfig = {
        projects: {
          'my-angular-app': {
            architect: {
              serve: {
                options: { port: 4200 },
              },
            },
          },
        },
      };
      await writeFile(join(testDir, 'angular.json'), JSON.stringify(angularConfig));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 4200,
        name: 'my-angular-app',
        source: 'angular.json',
        confidence: 90,
      });
    });

    it('should detect ports from grouped Nx workspace (apps/group/app/project.json)', async () => {
      await mkdir(join(testDir, 'apps', 'frontend', 'dashboard'), { recursive: true });
      const project = {
        name: 'dashboard',
        targets: {
          serve: {
            options: { port: 4300 },
          },
        },
      };
      await writeFile(join(testDir, 'apps', 'frontend', 'dashboard', 'project.json'), JSON.stringify(project));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 4300,
        name: 'dashboard',
        source: 'apps/frontend/dashboard/project.json',
        confidence: 90,
      });
    });

    it('should detect ports from multiple targets', async () => {
      await mkdir(join(testDir, 'apps', 'multi-target'), { recursive: true });
      const project = {
        name: 'multi-target',
        targets: {
          serve: {
            options: { port: 4200 },
          },
          storybook: {
            options: { port: 6006 },
          },
        },
      };
      await writeFile(join(testDir, 'apps', 'multi-target', 'project.json'), JSON.stringify(project));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.map((p) => p.port).sort()).toEqual([4200, 6006]);
    });
  });

  describe('detectFromFrameworkConfigs', () => {
    it('should detect port from vite.config.ts', async () => {
      const config = `
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
  },
});
`;
      await writeFile(join(testDir, 'vite.config.ts'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3000,
        name: 'Vite',
        source: 'vite.config.ts',
        confidence: 85,
      });
    });

    it('should detect port from webpack.config.js', async () => {
      const config = `
module.exports = {
  devServer: {
    port: 8080,
  },
};
`;
      await writeFile(join(testDir, 'webpack.config.js'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 8080,
        name: 'Webpack',
        source: 'webpack.config.js',
        confidence: 85,
      });
    });

    it('should detect port from next.config.mjs', async () => {
      const config = `
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverRuntimeConfig: {
    port: 3001,
  },
};
export default nextConfig;
`;
      await writeFile(join(testDir, 'next.config.mjs'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3001,
        name: 'Next.js',
        source: 'next.config.mjs',
        confidence: 85,
      });
    });

    it('should skip port numbers inside comments', async () => {
      const config = `
import { defineConfig } from 'vite';

export default defineConfig({
  // port: 9999
  /* port: 8888 */
  * port: 7777
  server: {
    port: 3000,
  },
});
`;
      await writeFile(join(testDir, 'vite.config.ts'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });

    it('should detect port from process.env fallback pattern', async () => {
      const config = `
export default defineConfig({
  server: {
    port: process.env.PORT || 5173,
  },
});
`;
      await writeFile(join(testDir, 'vite.config.ts'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(5173);
    });

    it('should detect port from nullish coalescing fallback', async () => {
      const config = `
export default {
  server: {
    port: process.env.DEV_PORT ?? 4000,
  },
};
`;
      await writeFile(join(testDir, 'vite.config.ts'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(4000);
    });

    it('should detect port from nuxt.config.ts', async () => {
      const config = `
export default defineNuxtConfig({
  devServer: {
    port: 3100,
  },
});
`;
      await writeFile(join(testDir, 'nuxt.config.ts'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3100,
        name: 'Nuxt',
        source: 'nuxt.config.ts',
        confidence: 85,
      });
    });

    it('should not duplicate port from both port: and process.env pattern', async () => {
      const config = `
export default defineConfig({
  server: {
    port: process.env.PORT || 3000,
    hmr: { port: 3000 },
  },
});
`;
      await writeFile(join(testDir, 'vite.config.ts'), config);

      const ports = await detectPorts(testDir);

      // Should deduplicate across patterns - only one entry for port 3000
      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });
  });

  describe('detectFromDockerfile', () => {
    it('should detect EXPOSE ports', async () => {
      await writeFile(join(testDir, 'Dockerfile'), 'FROM node:18\nEXPOSE 3000\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3000,
        source: 'Dockerfile',
        confidence: 70,
      });
    });

    it('should detect multiple EXPOSE ports on one line', async () => {
      await writeFile(join(testDir, 'Dockerfile'), 'FROM node:18\nEXPOSE 3000 8080\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.map((p) => p.port).sort()).toEqual([3000, 8080]);
    });

    it('should detect EXPOSE with protocol suffix', async () => {
      await writeFile(join(testDir, 'Dockerfile'), 'FROM node:18\nEXPOSE 3000/tcp\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });

    it('should detect ENV PORT', async () => {
      await writeFile(join(testDir, 'Dockerfile'), 'FROM node:18\nENV PORT=8080\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 8080,
        name: 'PORT',
        source: 'Dockerfile',
        confidence: 70,
      });
    });

    it('should detect ENV PORT with space separator', async () => {
      await writeFile(join(testDir, 'Dockerfile'), 'FROM node:18\nENV PORT 3000\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });

    it('should detect ENV APP_PORT', async () => {
      await writeFile(join(testDir, 'Dockerfile'), 'FROM node:18\nENV APP_PORT=9000\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 9000,
        name: 'APP_PORT',
        source: 'Dockerfile',
        confidence: 70,
      });
    });

    it('should detect from Dockerfile.dev', async () => {
      await writeFile(join(testDir, 'Dockerfile.dev'), 'FROM node:18\nEXPOSE 4000\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].source).toBe('Dockerfile.dev');
    });
  });

  describe('detectFromNestEntry', () => {
    it('should detect direct port from app.listen(3000)', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'main.ts'), `
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
`);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3000,
        name: 'Server',
        source: 'src/main.ts',
        confidence: 80,
      });
    });

    it('should detect fallback port from process.env.PORT || 3000', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'main.ts'), `
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
`);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });

    it('should detect fallback port with nullish coalescing', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'main.ts'), `
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 4000);
}
`);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(4000);
    });

    it('should detect from src/main.js', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'main.js'), `
const express = require('express');
const app = express();
app.listen(8080);
`);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 8080,
        source: 'src/main.js',
        confidence: 80,
      });
    });

    it('should detect port from parseInt fallback', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'main.ts'), `
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(parseInt(process.env.PORT, 10) || 3000);
}
`);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });

    it('should detect from src/server.ts', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'server.ts'), `
import express from 'express';
const app = express();
app.listen(4000);
`);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 4000,
        name: 'Server',
        source: 'src/server.ts',
        confidence: 80,
      });
    });

    it('should skip listen() calls in comments', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'main.ts'), `
// app.listen(9999);
/* app.listen(8888); */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
`);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
    });

    it('should not detect when no listen call exists', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await writeFile(join(testDir, 'src', 'main.ts'), `
export function main() {
  console.log('Hello');
}
`);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(0);
    });
  });

  describe('detectFromPackageJsonScripts', () => {
    it('should detect --port flag from scripts', async () => {
      const pkg = {
        name: 'test',
        scripts: {
          dev: 'vite --port 3000',
        },
      };
      await writeFile(join(testDir, 'package.json'), JSON.stringify(pkg));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0]).toMatchObject({
        port: 3000,
        name: 'dev',
        source: 'package.json scripts',
        confidence: 70,
      });
    });

    it('should detect --port= syntax', async () => {
      const pkg = {
        name: 'test',
        scripts: {
          start: 'ng serve --port=4200',
        },
      };
      await writeFile(join(testDir, 'package.json'), JSON.stringify(pkg));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(4200);
    });

    it('should detect -p shorthand', async () => {
      const pkg = {
        name: 'test',
        scripts: {
          dev: 'next dev -p 3001',
        },
      };
      await writeFile(join(testDir, 'package.json'), JSON.stringify(pkg));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3001);
    });

    it('should detect ports from multiple scripts', async () => {
      const pkg = {
        name: 'test',
        scripts: {
          dev: 'vite --port 3000',
          storybook: 'storybook dev -p 6006',
        },
      };
      await writeFile(join(testDir, 'package.json'), JSON.stringify(pkg));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(2);
      expect(ports.map((p) => p.port).sort()).toEqual([3000, 6006]);
    });

    it('should not match docker -p port mappings', async () => {
      const pkg = {
        name: 'test',
        scripts: {
          docker: 'docker run -p 3000:80 my-image',
        },
      };
      await writeFile(join(testDir, 'package.json'), JSON.stringify(pkg));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(0);
    });

    it('should ignore scripts without port flags', async () => {
      const pkg = {
        name: 'test',
        scripts: {
          build: 'tsc',
          lint: 'eslint src/',
        },
      };
      await writeFile(join(testDir, 'package.json'), JSON.stringify(pkg));

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(0);
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

    it('should prioritize docker-compose over .env files', async () => {
      const compose = `
version: '3'
services:
  web:
    ports:
      - "3000:3000"
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose);
      await writeFile(join(testDir, '.env'), 'PORT=3000\n');

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].confidence).toBe(95);
      expect(ports[0].source).toBe('docker-compose.yml');
    });

    it('should prioritize Nx project.json over framework configs', async () => {
      await mkdir(join(testDir, 'apps', 'my-app'), { recursive: true });
      const project = {
        name: 'my-app',
        targets: { serve: { options: { port: 4200 } } },
      };
      await writeFile(join(testDir, 'apps', 'my-app', 'project.json'), JSON.stringify(project));

      const config = `
export default defineConfig({
  server: { port: 4200 },
});
`;
      await writeFile(join(testDir, 'vite.config.ts'), config);

      const ports = await detectPorts(testDir);

      expect(ports).toHaveLength(1);
      expect(ports[0].confidence).toBe(90);
    });
  });

  describe('integration - all detectors combined', () => {
    it('should detect ports from multiple sources and deduplicate', async () => {
      // Docker compose with port 3000 and 5432
      const compose = `
version: '3'
services:
  web:
    ports:
      - "3000:3000"
  db:
    ports:
      - "5432:5432"
`;
      await writeFile(join(testDir, 'docker-compose.yml'), compose);

      // .env with PORT=3000 (duplicate) and REDIS_PORT=6379 (unique)
      await writeFile(join(testDir, '.env'), 'PORT=3000\nREDIS_PORT=6379\n');

      // Dockerfile with EXPOSE 3000 (duplicate) and EXPOSE 8080 (unique)
      await writeFile(join(testDir, 'Dockerfile'), 'FROM node:18\nEXPOSE 3000 8080\n');

      const ports = await detectPorts(testDir);

      // 3000 from compose (95), 5432 from compose (95), 6379 from .env (80), 8080 from Dockerfile (70)
      expect(ports).toHaveLength(4);
      expect(ports.map((p) => p.port).sort()).toEqual([3000, 5432, 6379, 8080]);

      // Port 3000 should come from compose (highest confidence)
      const port3000 = ports.find((p) => p.port === 3000)!;
      expect(port3000.confidence).toBe(95);
      expect(port3000.source).toBe('docker-compose.yml');
    });
  });

  describe('DetectOptions', () => {
    it('should accept string for backward compatibility', async () => {
      await writeFile(join(testDir, '.env'), 'PORT=3000\n');

      const ports = await detectPorts(testDir);
      expect(ports).toHaveLength(1);
    });

    it('should accept options object with cwd', async () => {
      await writeFile(join(testDir, '.env'), 'PORT=3000\n');

      const ports = await detectPorts({ cwd: testDir });
      expect(ports).toHaveLength(1);
    });

    it('should accept options object with verbose', async () => {
      await writeFile(join(testDir, '.env'), 'PORT=3000\n');

      // Should not throw with verbose enabled
      const ports = await detectPorts({ cwd: testDir, verbose: true });
      expect(ports).toHaveLength(1);
    });

    it('should respect detect.exclude from .portguardian.yml', async () => {
      const config = `
ports:
  - port: 3000
    name: App
detect:
  exclude:
    - ".env files"
    - Dockerfile
`;
      await writeFile(join(testDir, '.portguardian.yml'), config);
      await writeFile(join(testDir, '.env'), 'PORT=4000\n');
      await writeFile(join(testDir, 'Dockerfile'), 'FROM node:18\nEXPOSE 5000\n');

      const ports = await detectPorts(testDir);

      // Should find port 3000 from config, but NOT 4000 from .env or 5000 from Dockerfile
      expect(ports).toHaveLength(1);
      expect(ports[0].port).toBe(3000);
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
