/**
 * Port Detector - Auto-detect required ports from project files
 */

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PortSource, PortGuardianConfig } from './types.js';

/**
 * Detect all ports from various project sources
 */
export async function detectPorts(cwd: string = process.cwd()): Promise<PortSource[]> {
  const sources: PortSource[] = [];

  // Try each detector in priority order
  const detectors = [
    detectFromPortGuardianYml,
    detectFromPackageJson,
    detectFromDockerCompose,
  ];

  for (const detector of detectors) {
    try {
      const detected = await detector(cwd);
      sources.push(...detected);
    } catch {
      // Detector failed, continue to next
    }
  }

  // Deduplicate by port number, keeping highest confidence
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
 * Detect from docker-compose.yml (95% confidence)
 */
async function detectFromDockerCompose(cwd: string): Promise<PortSource[]> {
  const fileNames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

  for (const fileName of fileNames) {
    const filePath = join(cwd, fileName);
    if (await fileExists(filePath)) {
      return parseDockerCompose(filePath, fileName);
    }
  }

  return [];
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
 * Parse a docker-compose port mapping to get host port
 * Handles: "3000", "3000:80", "127.0.0.1:3000:80"
 */
function parsePortMapping(mapping: string | number): number | null {
  if (typeof mapping === 'number') {
    return mapping;
  }

  const str = String(mapping);

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
