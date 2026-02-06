/**
 * CLI Entry Point - Arg parsing and command dispatch
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findAvailablePort } from './scanner.js';
import { detectPorts } from './detector.js';
import { scan, killPort } from './index.js';
import { printHelp } from './cli-help.js';
import { initCommand } from './cli-init.js';
import { interactiveResolve, forceKillAll } from './cli-interactive.js';
import {
  printHeader,
  printDetectedPorts,
  printError,
  printScanOutput,
  printKillResult,
} from './ui.js';
import type { CliOptions, OutputContext } from './types.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);
const VERSION = packageJson.version;

/**
 * Parse and validate port strings, returning valid port numbers or exiting on error
 */
function parseAndValidatePorts(positionals: string[]): number[] {
  const parsed = positionals.map((p) => parseInt(p, 10));
  const invalidEntries = positionals.filter((_, i) => isNaN(parsed[i]) || parsed[i] < 1 || parsed[i] > 65535);

  if (invalidEntries.length > 0) {
    printError(`Invalid port(s): ${invalidEntries.join(', ')}. Ports must be 1-65535.`);
    process.exit(1);
  }

  return parsed;
}

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      force: { type: 'boolean', short: 'f', default: false },
      ci: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      find: { type: 'boolean', default: false },
      kill: { type: 'boolean', short: 'k', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log(`port-guardian v${VERSION}`);
    process.exit(0);
  }

  // Handle init command
  if (positionals[0] === 'init') {
    await initCommand(values.force ?? false, values.ci ?? false);
    process.exit(0);
  }

  // Check for conflicting flags
  if (values.find && values.kill) {
    printError('Cannot use --find and --kill together.');
    process.exit(1);
  }

  // --find mode: find an available port and print it
  if (values.find) {
    let basePort: number | undefined;

    if (positionals.length > 0) {
      const parsed = parseAndValidatePorts([positionals[0]]);
      basePort = parsed[0];
    }

    const available = await findAvailablePort(basePort);
    if (values.json) {
      console.log(JSON.stringify({ port: available }));
    } else {
      console.log(available);
    }
    process.exit(0);
  }

  // --kill mode: kill process on given port(s) and exit
  if (values.kill) {
    if (positionals.length === 0) {
      printError('--kill requires at least one port. Usage: port-guardian --kill 3000');
      process.exit(1);
    }

    const parsedPorts = parseAndValidatePorts(positionals);

    const dryRun = values['dry-run'] ?? false;
    const force = values.force ?? false;
    const results = await Promise.all(
      parsedPorts.map((port) => killPort(port, { dryRun, force }))
    );
    const hasErrors = results.some((r) => !r.killed && !r.wasAvailable);

    if (values.json) {
      console.log(JSON.stringify(results.length === 1 ? results[0] : results));
    } else {
      for (const r of results) {
        printKillResult(r, dryRun);
      }
    }

    process.exit(hasErrors ? 1 : 0);
  }

  const options: CliOptions = {
    force: values.force ?? false,
    ci: values.ci ?? false,
    dryRun: values['dry-run'] ?? false,
    verbose: values.verbose ?? false,
  };

  // Determine output context
  const context: OutputContext = {
    mode: positionals.length === 0 ? 'auto-detect'
        : positionals.length === 1 ? 'single'
        : 'multi',
  };

  // Get ports to check
  let ports: number[];

  if (context.mode === 'auto-detect') {
    printHeader();
    const sources = await detectPorts(options.verbose ? { verbose: true } : undefined);
    printDetectedPorts(sources);
    ports = sources.map((s) => s.port);
  } else {
    ports = parseAndValidatePorts(positionals);
  }

  if (ports.length === 0) {
    printError(
      'No ports detected. Checked: .portguardian.yml, package.json, docker-compose, .env files, Nx/Angular project.json, framework configs, Dockerfile.\n' +
      '  Specify ports explicitly or create a .portguardian.yml config.'
    );
    process.exit(1);
  }

  // Scan ports
  const scanResult = await scan({ ports });

  printScanOutput(scanResult, context);

  if (!scanResult.hasConflicts) {
    process.exit(0);
  }

  // Handle conflicts
  if (options.ci) {
    printError('Port conflicts detected. Exiting (CI mode).');
    process.exit(1);
  }

  if (options.force) {
    await forceKillAll(scanResult.ports, options);
  } else {
    await interactiveResolve(scanResult.ports, options);
  }
}

// Run when invoked directly or via bin wrapper (not when imported for testing)
const entry = fileURLToPath(import.meta.url);
const isCli = process.argv[1] && (
  process.argv[1] === entry ||
  process.argv[1].endsWith('/port-guardian.js') ||
  process.argv[1].endsWith('/port-guardian')
);
if (isCli) {
  main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
