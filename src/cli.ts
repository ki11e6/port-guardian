/**
 * CLI Entry Point - Command-line interface
 */

import { parseArgs } from 'node:util';
import inquirer from 'inquirer';
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
    console.log('port-guardian v0.1.0');
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
    // Explicit ports from CLI args
    ports = positionals.map((p) => parseInt(p, 10)).filter((p) => !isNaN(p));
    printInfo(`Checking ${ports.length} port(s) from command line`);
  } else {
    // Auto-detect from project files
    const spinner = ora('Detecting ports from project files...').start();
    const sources = await detectPorts();
    spinner.stop();

    printDetectedPorts(sources);
    ports = sources.map((s) => s.port);
  }

  if (ports.length === 0) {
    printError('No ports to check. Specify ports or create configuration.');
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
    } else {
      const blocker = await resolveBlocker(result.process!, port);
      const warnings = generateWarnings(blocker);

      portStatuses.push({
        port,
        available: false,
        blocker,
        warnings,
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

/**
 * Build action choices based on blocker type
 */
function buildActionChoices(blocker: Blocker): inquirer.ChoiceCollection {
  const choices: inquirer.ChoiceCollection = [];

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

  Configuration:
    Create .portguardian.yml or add portGuardian to package.json
`);
}

// Run if called directly
main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
