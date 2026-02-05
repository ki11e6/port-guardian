/**
 * CLI Entry Point - Command-line interface
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import inquirer from 'inquirer';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);
const VERSION = packageJson.version;
import ora from 'ora';
import { detectPorts } from './detector.js';
import { checkPorts } from './scanner.js';
import { resolveBlocker, generateWarnings } from './resolver.js';
import { killBlocker } from './killer.js';
import {
  printHeader,
  printDetectedPorts,
  printScanResults,
  printRestartWarning,
  printSuccess,
  printError,
  printInfo,
  printSummary,
} from './ui.js';
import type { PortStatus, ScanResult, CliOptions, Blocker } from './types.js';

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

  const options: CliOptions = {
    force: values.force ?? false,
    ci: values.ci ?? false,
    dryRun: values['dry-run'] ?? false,
    verbose: values.verbose ?? false,
  };

  printHeader();

  // Get ports to check
  let ports: number[];

  if (positionals.length > 0) {
    // Explicit ports from CLI args with validation
    const parsedPorts = positionals.map((p) => parseInt(p, 10));
    const invalidPorts = parsedPorts.filter((p) => isNaN(p) || p < 1 || p > 65535);

    if (invalidPorts.length > 0) {
      printError(`Invalid port(s): ${positionals.filter((_, i) => isNaN(parsedPorts[i]) || parsedPorts[i] < 1 || parsedPorts[i] > 65535).join(', ')}. Ports must be 1-65535.`);
      process.exit(1);
    }

    ports = parsedPorts;
    printInfo(`Checking ${ports.length} port(s) from command line`);
  } else {
    // Auto-detect from project files
    const spinner = ora('Detecting ports from project files...').start();
    const sources = await detectPorts({ verbose: options.verbose });
    spinner.stop();

    printDetectedPorts(sources);
    ports = sources.map((s) => s.port);
  }

  if (ports.length === 0) {
    printError(
      'No ports detected. Checked: .portguardian.yml, package.json, docker-compose, .env files, Nx/Angular project.json, framework configs, Dockerfile.\n' +
      '  Specify ports explicitly or create a .portguardian.yml config.'
    );
    process.exit(1);
  }

  // Scan ports
  const spinner = ora('Scanning ports...').start();
  const scanResults = await checkPorts(ports);
  spinner.stop();

  // Build port status with resolution
  const portStatuses: PortStatus[] = [];

  for (const port of ports) {
    const result = scanResults.get(port);

    if (!result || result.available) {
      portStatuses.push({
        port,
        available: true,
        warnings: [],
      });
    } else if (result.process) {
      const blocker = await resolveBlocker(result.process, port);
      const warnings = generateWarnings(blocker);

      portStatuses.push({
        port,
        available: false,
        blocker,
        warnings,
      });
    } else {
      // Port is blocked but we couldn't identify the process
      portStatuses.push({
        port,
        available: false,
        warnings: ['Unable to identify blocking process. Try running with sudo.'],
      });
    }
  }

  const scanResult: ScanResult = {
    ports: portStatuses,
    hasConflicts: portStatuses.some((p) => !p.available),
    conflictCount: portStatuses.filter((p) => !p.available).length,
  };

  printScanResults(scanResult);
  printSummary(scanResult);

  if (!scanResult.hasConflicts) {
    printSuccess('All ports are available!');
    process.exit(0);
  }

  // Handle conflicts
  if (options.ci) {
    // Non-interactive mode
    printError('Port conflicts detected. Exiting (CI mode).');
    process.exit(1);
  }

  if (options.force) {
    // Force kill all blockers
    await forceKillAll(portStatuses, options);
  } else {
    // Interactive resolution
    await interactiveResolve(portStatuses, options);
  }
}

/**
 * Force kill all blockers
 */
async function forceKillAll(
  portStatuses: PortStatus[],
  options: CliOptions
): Promise<void> {
  const blockedPorts = portStatuses.filter((p) => !p.available && p.blocker);

  for (const port of blockedPorts) {
    const result = await killBlocker(port.blocker!, { dryRun: options.dryRun });

    if (result.success) {
      printSuccess(`Port ${port.port}: ${result.command}`);
    } else {
      printError(`Port ${port.port}: ${result.error}`);
    }
  }
}

/**
 * Interactive resolution flow
 */
async function interactiveResolve(
  portStatuses: PortStatus[],
  options: CliOptions
): Promise<void> {
  const blockedPorts = portStatuses.filter((p) => !p.available && p.blocker);

  for (const port of blockedPorts) {
    const blocker = port.blocker!;

    // Show restart warning if applicable
    if (blocker.docker?.restartPolicy === 'always') {
      printRestartWarning(blocker.docker.containerName);
    }

    const choices = buildActionChoices(blocker);

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: `Port ${port.port} - Choose action:`,
        choices,
      },
    ]);

    if (action === 'skip') {
      printInfo(`Skipped port ${port.port}`);
      continue;
    }

    if (action === 'abort') {
      printInfo('Aborted');
      process.exit(1);
    }

    // Execute the action
    const result = await killBlocker(blocker, { dryRun: options.dryRun });

    if (result.success) {
      printSuccess(`Executed: ${result.command}`);
    } else {
      printError(`Failed: ${result.error}`);
    }
  }
}

interface Choice {
  name: string;
  value: string;
}

/**
 * Build action choices based on blocker type
 */
function buildActionChoices(blocker: Blocker): Choice[] {
  const choices: Choice[] = [];

  if (blocker.isOrphanedDockerProxy) {
    choices.push({
      name: 'Kill orphaned docker-proxy (recommended, safe)',
      value: 'kill',
    });
  } else if (blocker.type === 'docker-container') {
    if (blocker.docker?.restartPolicy === 'always') {
      choices.push({
        name: `Stop and remove container (recommended, permanent)`,
        value: 'stop-and-remove',
      });
      choices.push({
        name: `Stop container only (may restart)`,
        value: 'stop',
      });
    } else {
      choices.push({
        name: `Stop container`,
        value: 'stop',
      });
    }
  } else {
    choices.push({
      name: `Kill process (PID ${blocker.pid})`,
      value: 'kill',
    });
  }

  choices.push({ name: 'Skip this port', value: 'skip' });
  choices.push({ name: 'Abort', value: 'abort' });

  return choices;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
  Usage: port-guardian [ports...] [options]

  Options:
    -f, --force     Kill all blockers without prompting
    --ci            Non-interactive mode (exit 1 on conflicts)
    --dry-run       Show what would be done without executing
    -v, --verbose   Verbose output
    -h, --help      Show this help message
    --version       Show version

  Examples:
    port-guardian                  # Auto-detect ports
    port-guardian 3000 8080        # Check specific ports
    port-guardian --force          # Kill all blockers
    port-guardian --ci             # CI mode (fail on conflicts)

  Port Detection Sources (auto-detect order):
    .portguardian.yml       100%  - Explicit port configuration
    package.json            100%  - portGuardian field
    docker-compose*.yml      95%  - All compose files (glob)
    Nx/Angular project.json  90%  - Serve target ports
    Framework configs        85%  - vite, webpack, next, nuxt
    .env files             70-85% - PORT=, *_PORT=, localhost URLs
    Dockerfile               70%  - EXPOSE and ENV PORT directives
`);
}

// Run if called directly
main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
