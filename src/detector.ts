/**
 * Port Detector - Auto-detect required ports from project files
 */

import { readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PortSource, PortGuardianConfig, DetectOptions } from './types.js';

/**
 * Detect all ports from various project sources
 */
export async function detectPorts(optionsOrCwd?: string | DetectOptions): Promise<PortSource[]> {
  const opts: DetectOptions = typeof optionsOrCwd === 'string'
    ? { cwd: optionsOrCwd }
    : optionsOrCwd ?? {};

  const cwd = opts.cwd ?? process.cwd();
  const verbose = opts.verbose ?? false;

  // Merge exclude from options and .portguardian.yml config
  const configExclude = await readConfigExclude(cwd);
  const exclude = [...(opts.exclude ?? []), ...configExclude];

  const sources: PortSource[] = [];

  const detectors: Array<{ name: string; fn: (cwd: string) => Promise<PortSource[]> }> = [
    { name: '.portguardian.yml', fn: detectFromPortGuardianYml },
    { name: 'package.json', fn: detectFromPackageJson },
    { name: 'docker-compose', fn: detectFromDockerCompose },
    { name: '.env files', fn: detectFromEnvFiles },
    { name: 'Nx/Angular project.json', fn: detectFromNxProjects },
    { name: 'framework configs', fn: detectFromFrameworkConfigs },
    { name: 'Dockerfile', fn: detectFromDockerfile },
    { name: 'server entry point', fn: detectFromNestEntry },
    { name: 'package.json scripts', fn: detectFromPackageJsonScripts },
    { name: 'framework defaults', fn: detectFromFrameworkDefaults },
  ];

  for (const detector of detectors) {
    if (exclude.includes(detector.name)) {
      continue;
    }
    try {
      const detected = await detector.fn(cwd);
      if (verbose) {
        console.error(`[detect] ${detector.name}: found ${detected.length} port(s)`);
      }
      sources.push(...detected);
    } catch {
      if (verbose) {
        console.error(`[detect] ${detector.name}: failed`);
      }
    }
  }

  return deduplicatePorts(sources);
}

/**
 * Detect from .portguardian.yml (100% confidence)
 */
async function detectFromPortGuardianYml(cwd: string): Promise<PortSource[]> {
  const filePath = join(cwd, '.portguardian.yml');

  if (!(await fileExists(filePath))) {
    return [];
  }

  const content = await readFile(filePath, 'utf-8');
  const config = parseYaml(content) as PortGuardianConfig;

  if (!config?.ports || !Array.isArray(config.ports)) {
    return [];
  }

  return config.ports.map((p) => ({
    port: p.port,
    name: p.name,
    source: '.portguardian.yml',
    confidence: 100,
  }));
}

/**
 * Detect from package.json portGuardian field (100% confidence)
 */
async function detectFromPackageJson(cwd: string): Promise<PortSource[]> {
  const filePath = join(cwd, 'package.json');

  if (!(await fileExists(filePath))) {
    return [];
  }

  const content = await readFile(filePath, 'utf-8');
  const pkg = JSON.parse(content);

  if (!pkg?.portGuardian?.ports || !Array.isArray(pkg.portGuardian.ports)) {
    return [];
  }

  return pkg.portGuardian.ports.map((p: { port: number; name?: string }) => ({
    port: p.port,
    name: p.name,
    source: 'package.json',
    confidence: 100,
  }));
}

/**
 * Detect from docker-compose files (95% confidence)
 * Uses regex to find non-standard variants (e.g., docker-compose.dev.yml)
 * and a fallback list for standard names (docker-compose.yml, compose.yml)
 */
async function detectFromDockerCompose(cwd: string): Promise<PortSource[]> {
  const composePattern = /^(docker-)?compose[.\-].*\.(yml|yaml)$/;
  const fallbackNames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

  const matchedFiles = new Set<string>();

  // Scan directory for compose files matching pattern or fallback names
  try {
    const entries = await readdir(cwd);
    for (const entry of entries) {
      if (composePattern.test(entry) || fallbackNames.includes(entry)) {
        matchedFiles.add(entry);
      }
    }
  } catch {
    // Directory read failed, try fallbacks only
    for (const name of fallbackNames) {
      if (await fileExists(join(cwd, name))) {
        matchedFiles.add(name);
      }
    }
  }

  const allPorts: PortSource[] = [];

  for (const fileName of matchedFiles) {
    const filePath = join(cwd, fileName);
    const ports = await parseDockerCompose(filePath, fileName);
    allPorts.push(...ports);
  }

  return allPorts;
}

/**
 * Parse docker-compose.yml for port mappings
 */
async function parseDockerCompose(
  filePath: string,
  fileName: string
): Promise<PortSource[]> {
  const content = await readFile(filePath, 'utf-8');
  const compose = parseYaml(content);

  if (!compose?.services) {
    return [];
  }

  const ports: PortSource[] = [];

  for (const [serviceName, service] of Object.entries(compose.services)) {
    const servicePorts = (service as { ports?: (string | number)[] })?.ports;

    if (!servicePorts || !Array.isArray(servicePorts)) {
      continue;
    }

    for (const portMapping of servicePorts) {
      const hostPort = parsePortMapping(portMapping);
      if (hostPort) {
        ports.push({
          port: hostPort,
          name: serviceName,
          source: fileName,
          confidence: 95,
        });
      }
    }
  }

  return ports;
}

/**
 * Detect from .env files
 */
async function detectFromEnvFiles(cwd: string): Promise<PortSource[]> {
  const envFiles = ['.env', '.env.local', '.env.development', '.env.dev'];
  const ports: PortSource[] = [];

  for (const fileName of envFiles) {
    const filePath = join(cwd, fileName);
    if (!(await fileExists(filePath))) {
      continue;
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const rawLine of lines) {
      // Strip inline comments (but not inside quotes)
      const line = rawLine.replace(/\s+#.*$/, '').trim();

      // Skip empty lines, comments, variable references
      if (!line || line.startsWith('#') || line.includes('${')) {
        continue;
      }

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();

      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Pattern 1: PORT=<number>
      if (key === 'PORT') {
        const port = parseInt(value, 10);
        if (isValidPort(port)) {
          ports.push({ port, name: 'PORT', source: fileName, confidence: 85 });
        }
        continue;
      }

      // Pattern 2: Keys with PORT as a distinct segment (bounded by _ or string edges)
      // Matches: DB_PORT, REDIS_PORT, PORT_NUMBER, APP_PORT_FORWARD
      // Rejects: PASSPORT_SECRET, TRANSPORT_MODE, EXPORT_PATH
      if (/^[A-Z0-9]+_PORT$/.test(key) || /^PORT_[A-Z0-9_]+$/.test(key) || /^[A-Z0-9]+_PORT_[A-Z0-9_]+$/.test(key)) {
        const port = parseInt(value, 10);
        if (isValidPort(port)) {
          const name = key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
          ports.push({ port, name, source: fileName, confidence: 80 });
        }
        continue;
      }

      // Pattern 3: URLs targeting localhost only
      const urlMatch = value.match(/\w+:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)/);
      if (urlMatch) {
        const port = parseInt(urlMatch[1], 10);
        if (isValidPort(port)) {
          const name = key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
          ports.push({ port, name, source: fileName, confidence: 70 });
        }
      }
    }
  }

  return ports;
}

/**
 * Detect from Nx/Angular project.json files
 */
async function detectFromNxProjects(cwd: string): Promise<PortSource[]> {
  const ports: PortSource[] = [];

  // Scan apps/ and packages/ for project.json (supports grouped layouts like apps/group/app/)
  for (const parentDir of ['apps', 'packages']) {
    const parentPath = join(cwd, parentDir);
    try {
      const entries = await readdir(parentPath);
      for (const entry of entries) {
        const projectJsonPath = join(parentPath, entry, 'project.json');
        if (await fileExists(projectJsonPath)) {
          extractNxPorts(await readFile(projectJsonPath, 'utf-8'), entry, `${parentDir}/${entry}/project.json`, ports);
        } else {
          // Check one level deeper for grouped Nx workspaces (apps/group/app/project.json)
          try {
            const subEntries = await readdir(join(parentPath, entry));
            for (const subEntry of subEntries) {
              const nestedPath = join(parentPath, entry, subEntry, 'project.json');
              if (await fileExists(nestedPath)) {
                extractNxPorts(await readFile(nestedPath, 'utf-8'), subEntry, `${parentDir}/${entry}/${subEntry}/project.json`, ports);
              }
            }
          } catch {
            // Not a directory or read error, skip
          }
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  // Check angular.json in root
  const angularJsonPath = join(cwd, 'angular.json');
  if (await fileExists(angularJsonPath)) {
    try {
      const content = await readFile(angularJsonPath, 'utf-8');
      const angularConfig = JSON.parse(content);

      if (angularConfig.projects && typeof angularConfig.projects === 'object') {
        for (const [projectName, project] of Object.entries(angularConfig.projects)) {
          const serve = (project as { architect?: { serve?: { options?: { port?: number } } } })
            ?.architect?.serve?.options?.port;
          if (typeof serve === 'number' && isValidPort(serve)) {
            ports.push({ port: serve, name: projectName, source: 'angular.json', confidence: 90 });
          }
        }
      }
    } catch {
      // Parse error, skip
    }
  }

  return ports;
}

/**
 * Detect from framework config files (vite, webpack, next, nuxt)
 */
async function detectFromFrameworkConfigs(cwd: string): Promise<PortSource[]> {
  const configs: Array<{ pattern: string; framework: string; extensions: string[] }> = [
    { pattern: 'vite.config', framework: 'Vite', extensions: ['ts', 'js', 'mjs'] },
    { pattern: 'webpack.config', framework: 'Webpack', extensions: ['js', 'ts'] },
    { pattern: 'next.config', framework: 'Next.js', extensions: ['js', 'mjs', 'ts'] },
    { pattern: 'nuxt.config', framework: 'Nuxt', extensions: ['js', 'ts'] },
  ];

  const ports: PortSource[] = [];

  for (const config of configs) {
    for (const ext of config.extensions) {
      const fileName = `${config.pattern}.${ext}`;
      const filePath = join(cwd, fileName);

      if (!(await fileExists(filePath))) {
        continue;
      }

      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip comment lines
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          continue;
        }

        // Match port: <number>
        const portMatch = trimmed.match(/port\s*:\s*(\d+)/);
        if (portMatch) {
          const port = parseInt(portMatch[1], 10);
          if (isValidPort(port)) {
            ports.push({ port, name: config.framework, source: fileName, confidence: 85 });
          }
        }

        // Match process.env.X || <number> or process.env.X ?? <number>
        const fallbackMatch = trimmed.match(/process\.env\.\w+\s*(?:\|\||[\?]{2})\s*(\d+)/);
        if (fallbackMatch) {
          const port = parseInt(fallbackMatch[1], 10);
          if (isValidPort(port)) {
            if (!ports.some((p) => p.port === port && p.source === fileName)) {
              ports.push({ port, name: config.framework, source: fileName, confidence: 85 });
            }
          }
        }
      }

      // Found a config file for this framework, skip remaining extensions
      break;
    }
  }

  return ports;
}

/**
 * Detect from Dockerfile
 */
async function detectFromDockerfile(cwd: string): Promise<PortSource[]> {
  const dockerfiles = ['Dockerfile', 'Dockerfile.dev'];
  const ports: PortSource[] = [];

  for (const fileName of dockerfiles) {
    const filePath = join(cwd, fileName);
    if (!(await fileExists(filePath))) {
      continue;
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // EXPOSE <port> [<port>...]
      const exposeMatch = trimmed.match(/^EXPOSE\s+(.+)/i);
      if (exposeMatch) {
        const portTokens = exposeMatch[1].split(/\s+/);
        for (const token of portTokens) {
          // Strip protocol suffix like /tcp, /udp
          const cleaned = token.replace(/\/(tcp|udp)$/i, '');
          const port = parseInt(cleaned, 10);
          if (isValidPort(port)) {
            ports.push({ port, source: fileName, confidence: 70 });
          }
        }
        continue;
      }

      // ENV PORT=<number> or ENV PORT <number>
      const envMatch = trimmed.match(/^ENV\s+((?:APP_)?PORT)\s*[= ]\s*(\d+)/i);
      if (envMatch) {
        const port = parseInt(envMatch[2], 10);
        if (isValidPort(port)) {
          ports.push({ port, name: envMatch[1], source: fileName, confidence: 70 });
        }
      }
    }
  }

  return ports;
}

/**
 * Detect from server entry points (NestJS, Express, Fastify, etc.)
 */
async function detectFromNestEntry(cwd: string): Promise<PortSource[]> {
  const files = [
    'src/main.ts', 'src/main.js',
    'src/server.ts', 'src/server.js',
  ];
  const ports: PortSource[] = [];

  for (const fileName of files) {
    const filePath = join(cwd, fileName);
    if (!(await fileExists(filePath))) continue;

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Pattern 1: .listen(3000) - direct numeric port (skip comment lines)
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

      const directMatch = trimmed.match(/\.listen\(\s*(\d+)/);
      if (directMatch) {
        const port = parseInt(directMatch[1], 10);
        if (isValidPort(port)) {
          ports.push({ port, name: 'Server', source: fileName, confidence: 80 });
          break;
        }
      }
    }

    // Pattern 2: line with .listen( containing || or ?? fallback (handles nested parens like parseInt())
    if (ports.length === 0) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

        if (/\.listen\(/.test(trimmed)) {
          const fallback = trimmed.match(/(?:\|\||[\?]{2})\s*(\d+)/);
          if (fallback) {
            const port = parseInt(fallback[1], 10);
            if (isValidPort(port)) {
              ports.push({ port, name: 'Server', source: fileName, confidence: 80 });
            }
            break;
          }
        }
      }
    }

    // Found an entry file, skip remaining
    break;
  }

  return ports;
}

/**
 * Detect from package.json scripts (--port flags)
 */
async function detectFromPackageJsonScripts(cwd: string): Promise<PortSource[]> {
  const filePath = join(cwd, 'package.json');
  if (!(await fileExists(filePath))) return [];

  const content = await readFile(filePath, 'utf-8');
  const pkg = JSON.parse(content);

  if (!pkg?.scripts || typeof pkg.scripts !== 'object') return [];

  const ports: PortSource[] = [];

  for (const [scriptName, scriptValue] of Object.entries(pkg.scripts)) {
    if (typeof scriptValue !== 'string') continue;

    // Match --port 3000, --port=3000, -p 3000, -p=3000
    // Negative lookahead (?![\d:]*:\d) avoids docker's -p 3000:80
    const matches = scriptValue.matchAll(/(?:--port|-p)[= ](\d+)\b(?!:)/g);
    for (const match of matches) {
      const port = parseInt(match[1], 10);
      if (isValidPort(port) && !ports.some((p) => p.port === port)) {
        ports.push({ port, name: scriptName, source: 'package.json scripts', confidence: 70 });
      }
    }
  }

  return ports;
}

/**
 * Detect framework default ports when config exists but no port is configured
 */
async function detectFromFrameworkDefaults(cwd: string): Promise<PortSource[]> {
  const ports: PortSource[] = [];

  const configs: Array<{ files: string[]; name: string; defaultPort: number }> = [
    { files: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'], name: 'Vite', defaultPort: 5173 },
    { files: ['next.config.js', 'next.config.mjs', 'next.config.ts'], name: 'Next.js', defaultPort: 3000 },
    { files: ['nuxt.config.js', 'nuxt.config.ts'], name: 'Nuxt', defaultPort: 3000 },
    { files: ['webpack.config.js', 'webpack.config.ts'], name: 'Webpack', defaultPort: 8080 },
  ];

  const portPattern = /\bport\s*[:=]\s*\d+|process\.env\.\w*PORT/;

  for (const config of configs) {
    for (const fileName of config.files) {
      const filePath = join(cwd, fileName);
      if (!(await fileExists(filePath))) continue;

      const content = await readFile(filePath, 'utf-8');

      // Only add default if no explicit port is configured
      if (!portPattern.test(content)) {
        ports.push({ port: config.defaultPort, name: `${config.name} (default)`, source: fileName, confidence: 50 });
      }

      break; // Found config for this framework
    }
  }

  // Angular: check angular.json for projects without serve port
  const angularPath = join(cwd, 'angular.json');
  if (await fileExists(angularPath)) {
    try {
      const content = await readFile(angularPath, 'utf-8');
      const config = JSON.parse(content);

      if (config.projects && typeof config.projects === 'object') {
        let hasAnyPort = false;
        for (const project of Object.values(config.projects)) {
          if ((project as { architect?: { serve?: { options?: { port?: number } } } })
            ?.architect?.serve?.options?.port) {
            hasAnyPort = true;
            break;
          }
        }
        if (!hasAnyPort) {
          ports.push({ port: 4200, name: 'Angular (default)', source: 'angular.json', confidence: 50 });
        }
      }
    } catch {
      // Parse error
    }
  }

  return ports;
}

/**
 * Port mapping can be string, number, or object (long syntax)
 */
interface LongSyntaxPort {
  target: number;
  published?: number | string;
  host_ip?: string;
  protocol?: string;
}

/**
 * Parse a docker-compose port mapping to get host port
 * Handles:
 * - Short syntax: "3000", "3000:80", "127.0.0.1:3000:80", "3000:80/tcp"
 * - Long syntax: { target: 80, published: 8080 }
 * - Ranges: "3000-3005:80-85"
 */
function parsePortMapping(mapping: string | number | LongSyntaxPort): number | null {
  // Handle long syntax (object form)
  if (typeof mapping === 'object' && mapping !== null) {
    const longSyntax = mapping as LongSyntaxPort;
    if (longSyntax.published !== undefined) {
      const published = typeof longSyntax.published === 'string'
        ? parseInt(longSyntax.published, 10)
        : longSyntax.published;
      return isNaN(published) ? null : published;
    }
    // If no published port, target is used as both
    return longSyntax.target || null;
  }

  if (typeof mapping === 'number') {
    return mapping;
  }

  let str = String(mapping);

  // Strip protocol suffix (e.g., "/tcp", "/udp")
  str = str.replace(/\/(tcp|udp)$/i, '');

  // Handle range (e.g., "3000-3005:80-85") - take first port
  if (str.includes('-')) {
    const match = str.match(/^(\d+)-/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  // Split by colon
  const parts = str.split(':');

  if (parts.length === 1) {
    // Just port: "3000"
    return parseInt(parts[0], 10) || null;
  }

  if (parts.length === 2) {
    // host:container: "3000:80"
    return parseInt(parts[0], 10) || null;
  }

  if (parts.length === 3) {
    // ip:host:container: "127.0.0.1:3000:80"
    return parseInt(parts[1], 10) || null;
  }

  return null;
}

/**
 * Extract port definitions from an Nx project.json content
 */
function extractNxPorts(content: string, fallbackName: string, source: string, ports: PortSource[]): void {
  const project = JSON.parse(content);
  const projectName = project.name ?? fallbackName;

  if (project.targets && typeof project.targets === 'object') {
    for (const [, target] of Object.entries(project.targets)) {
      const port = (target as { options?: { port?: number } })?.options?.port;
      if (typeof port === 'number' && isValidPort(port)) {
        ports.push({ port, name: projectName, source, confidence: 90 });
      }
    }
  }
}

/**
 * Read exclude list from .portguardian.yml config if it exists
 */
async function readConfigExclude(cwd: string): Promise<string[]> {
  try {
    const filePath = join(cwd, '.portguardian.yml');
    if (!(await fileExists(filePath))) return [];
    const content = await readFile(filePath, 'utf-8');
    const config = parseYaml(content) as PortGuardianConfig;
    return config?.detect?.exclude ?? [];
  } catch {
    return [];
  }
}

/**
 * Deduplicate ports, keeping highest confidence
 */
function deduplicatePorts(sources: PortSource[]): PortSource[] {
  const portMap = new Map<number, PortSource>();

  for (const source of sources) {
    const existing = portMap.get(source.port);
    if (!existing || source.confidence > existing.confidence) {
      portMap.set(source.port, source);
    }
  }

  return Array.from(portMap.values());
}

/**
 * Check if file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate port number is in valid range
 */
function isValidPort(port: number): boolean {
  return !isNaN(port) && port >= 1 && port <= 65535;
}
