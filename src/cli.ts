/**
 * CLI Entry Point - Command-line interface
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { writeFile, stat } from 'node:fs/promises';
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
import { detectPorts } from './detector.js';
import { findAvailablePort } from './scanner.js';
import { killBlocker } from './killer.js';
import { scan, killPort } from './index.js';
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
import type { PortStatus, CliOptions, Blocker, PortSource } from './types.js';

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
        if (r.wasAvailable) {
          console.log(`Port ${r.port}: already available`);
        } else if (r.killed) {
          const action = dryRun ? 'would kill' : 'killed';
          console.log(`Port ${r.port}: ${action} ${r.blocker?.process ?? 'unknown'} (PID ${r.blocker?.pid ?? '?'})${dryRun ? ' (dry-run)' : ''}`);
        } else {
          console.error(`Port ${r.port}: failed - ${r.error}`);
        }
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

  printHeader();

  // Get ports to check
  let ports: number[];

  if (positionals.length > 0) {
    // Explicit ports from CLI args with validation
    ports = parseAndValidatePorts(positionals);
    printInfo(`Checking ${ports.length} port(s) from command line`);
  } else {
    // Auto-detect from project files
    const sources = await detectPorts(options.verbose ? { verbose: true } : undefined);

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
  const scanResult = await scan({ ports });

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
    await forceKillAll(scanResult.ports, options);
  } else {
    // Interactive resolution
    await interactiveResolve(scanResult.ports, options);
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
    const result = await killBlocker(port.blocker!, { dryRun: options.dryRun, force: true });

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
      printRestartWarning();
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
 * Init command - generate .portguardian.yml from detected ports
 */
async function initCommand(force: boolean, ci: boolean): Promise<void> {
  const configPath = join(process.cwd(), '.portguardian.yml');

  // Check if config already exists
  const configExists = await stat(configPath).then(() => true, () => false);
  if (configExists) {
    if (!force && !ci) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: '.portguardian.yml already exists. Overwrite?',
        default: false,
      }]);
      if (!overwrite) {
        printInfo('Aborted');
        return;
      }
    }
  }

  // Detect ports (exclude .portguardian.yml to avoid circular detection)
  const sources = await detectPorts({ exclude: ['.portguardian.yml'] });

  if (sources.length === 0) {
    printInfo('No ports detected from project files.');
    printInfo('Creating empty config. Add ports manually.');
    const yaml = '# Port Guardian Configuration\n# See: https://github.com/ki11e6/port-guardian\nports: []\n';
    await writeFile(configPath, yaml);
    printSuccess('Created .portguardian.yml');
    return;
  }

  // Show detected ports
  printDetectedPorts(sources);

  // Confirm before writing
  if (!force && !ci) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Write ${sources.length} port(s) to .portguardian.yml?`,
      default: true,
    }]);
    if (!confirm) {
      printInfo('Aborted');
      return;
    }
  }

  const yamlContent = generatePortGuardianYaml(sources);
  await writeFile(configPath, yamlContent);
  printSuccess(`Created .portguardian.yml with ${sources.length} port(s)`);
}

/**
 * Generate .portguardian.yml content from detected ports
 */
export function generatePortGuardianYaml(sources: PortSource[]): string {
  let yaml = '# Port Guardian Configuration\n';
  yaml += '# Generated by: port-guardian init\n';
  yaml += '# See: https://github.com/ki11e6/port-guardian\n\n';
  yaml += 'ports:\n';

  for (const source of sources) {
    yaml += `  - port: ${source.port}\n`;
    if (source.name) {
      // Quote names with YAML-special characters
      const needsQuoting = /[:#\[\]{}&*?|>!%@`"']/.test(source.name) || source.name.trim() !== source.name;
      yaml += `    name: ${needsQuoting ? `"${source.name.replace(/"/g, '\\"')}"` : source.name}\n`;
    }
  }

  return yaml;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
  Usage: port-guardian [command] [ports...] [options]

  Commands:
    init            Generate .portguardian.yml from detected ports

  Options:
    -f, --force     Kill all blockers without prompting
    -k, --kill      Kill process on port(s) and exit
    --ci            Non-interactive mode (exit 1 on conflicts)
    --dry-run       Show what would be done without executing
    --find [port]   Find an available port (starting from port, or random)
    --json          Output as JSON (use with --find or --kill)
    -v, --verbose   Verbose output
    -h, --help      Show this help message
    --version       Show version

  Examples:
    port-guardian                  # Auto-detect ports
    port-guardian 3000 8080        # Check specific ports
    port-guardian --force          # Kill all blockers
    port-guardian --ci             # CI mode (fail on conflicts)
    port-guardian --kill 3000      # Kill whatever is on port 3000
    port-guardian -k 3000 8080     # Kill multiple ports
    port-guardian --kill 3000 --json  # Kill with JSON output
    port-guardian --find 3000      # Find available port from 3000
    port-guardian --find           # Find random available port
    port-guardian --find --json    # Output as JSON: {"port": 3001}
    port-guardian init             # Generate config from detected ports
    port-guardian init --force     # Overwrite existing config

  Port Detection Sources (auto-detect order):
    .portguardian.yml       100%  - Explicit port configuration
    package.json            100%  - portGuardian field
    docker-compose*.yml      95%  - All compose files (glob)
    Nx/Angular project.json  90%  - Serve target ports
    Framework configs        85%  - vite, webpack, next, nuxt
    Server entry point       80%  - src/main.ts, src/server.ts listen() calls
    .env files             70-85% - PORT=, *_PORT=, localhost URLs
    package.json scripts     70%  - --port flags in npm scripts
    Dockerfile               70%  - EXPOSE and ENV PORT directives
    Framework defaults       50%  - Inferred defaults (Vite=5173, etc.)
`);
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
