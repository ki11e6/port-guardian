/**
 * Terminal UI - Beautiful output formatting
 */

import chalk from 'chalk';
import type { PortStatus, Blocker, ScanResult, PortSource } from './types.js';

/**
 * Display the port-guardian header
 */
export function printHeader(): void {
  console.log();
  console.log(chalk.cyan.bold('  🔍 Port Guardian'));
  console.log(chalk.gray('  Stop debugging port conflicts. Start shipping.'));
  console.log();
}

/**
 * Display detected ports table
 */
export function printDetectedPorts(sources: PortSource[]): void {
  if (sources.length === 0) {
    console.log(chalk.yellow('  No ports detected from project files.'));
    console.log(chalk.gray('  Use: port-guardian <port> [port...] or create .portguardian.yml'));
    console.log();
    return;
  }

  console.log(chalk.white.bold('  Detected ports:'));
  console.log();
  console.log(
    chalk.gray('  SOURCE                PORT    NAME')
  );
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  for (const source of sources) {
    const name = source.name || '-';
    console.log(
      `  ${chalk.gray(source.source.padEnd(20))} ${chalk.white(String(source.port).padEnd(7))} ${chalk.cyan(name)}`
    );
  }
  console.log();
}

/**
 * Display scan results
 */
export function printScanResults(result: ScanResult): void {
  console.log(chalk.white.bold('  Port Status:'));
  console.log();

  for (const port of result.ports) {
    printPortStatus(port);
  }

  console.log();
}

/**
 * Display a single port status
 */
function printPortStatus(status: PortStatus): void {
  const portStr = String(status.port).padEnd(6);
  const nameStr = status.name ? `(${status.name})` : '';

  if (status.available) {
    console.log(`  ${chalk.green('✓')} Port ${chalk.white(portStr)} ${chalk.gray(nameStr)} ${chalk.green('Available')}`);
  } else {
    console.log(`  ${chalk.red('✗')} Port ${chalk.white(portStr)} ${chalk.gray(nameStr)} ${chalk.red('BLOCKED')}`);

    if (status.blocker) {
      printBlockerDetails(status.blocker);
    }

    for (const warning of status.warnings) {
      console.log(`     ${chalk.yellow('⚠')} ${chalk.yellow(warning)}`);
    }
  }
}

/**
 * Display blocker details
 */
function printBlockerDetails(blocker: Blocker): void {
  const typeLabel = getBlockerTypeLabel(blocker);

  console.log(`     ${chalk.gray('└─')} ${chalk.gray('Process:')} ${chalk.white(blocker.processName)} ${chalk.gray(`(PID ${blocker.pid})`)} ${typeLabel}`);

  if (blocker.docker) {
    console.log(`     ${chalk.gray('   └─')} ${chalk.gray('Container:')} ${chalk.cyan(blocker.docker.containerName)}`);

    if (blocker.docker.composeProject) {
      console.log(`     ${chalk.gray('   └─')} ${chalk.gray('Project:')} ${chalk.cyan(blocker.docker.composeProject)}`);
    }

    console.log(`     ${chalk.gray('   └─')} ${chalk.gray('State:')} ${formatContainerState(blocker.docker.state)}`);
    console.log(`     ${chalk.gray('   └─')} ${chalk.gray('Restart:')} ${formatRestartPolicy(blocker.docker.restartPolicy)}`);
  }
}

/**
 * Get human-readable blocker type label
 */
function getBlockerTypeLabel(blocker: Blocker): string {
  if (blocker.isOrphanedDockerProxy) {
    return chalk.magenta('[ORPHANED]');
  }
  if (blocker.hasRestartLoop) {
    return chalk.red('[RESTART LOOP]');
  }
  if (blocker.type === 'docker-container') {
    return chalk.blue('[DOCKER]');
  }
  return '';
}

/**
 * Format container state with color
 */
function formatContainerState(state: string): string {
  switch (state) {
    case 'running':
      return chalk.green(state);
    case 'exited':
    case 'dead':
      return chalk.red(state);
    default:
      return chalk.yellow(state);
  }
}

/**
 * Format restart policy with color
 */
function formatRestartPolicy(policy: string): string {
  if (policy === 'always') {
    return chalk.yellow(`${policy} ⚠`);
  }
  return chalk.gray(policy);
}

/**
 * Display warning box for restart:always
 */
export function printRestartWarning(): void {
  console.log();
  console.log(chalk.yellow('  ┌' + '─'.repeat(60) + '┐'));
  console.log(chalk.yellow('  │') + chalk.yellow.bold(' ⚠  WARNING: Container has restart:always policy') + ' '.repeat(11) + chalk.yellow('│'));
  console.log(chalk.yellow('  │') + ' '.repeat(60) + chalk.yellow('│'));
  console.log(chalk.yellow('  │') + '  Simply killing docker-proxy won\'t permanently fix this.  ' + chalk.yellow('│'));
  console.log(chalk.yellow('  │') + '  The container will restart when Docker daemon restarts.  ' + chalk.yellow('│'));
  console.log(chalk.yellow('  │') + ' '.repeat(60) + chalk.yellow('│'));
  console.log(chalk.yellow('  │') + chalk.white('  Recommended: Stop AND remove the container') + ' '.repeat(15) + chalk.yellow('│'));
  console.log(chalk.yellow('  └' + '─'.repeat(60) + '┘'));
  console.log();
}

/**
 * Display success message
 */
export function printSuccess(message: string): void {
  console.log(`  ${chalk.green('✓')} ${message}`);
}

/**
 * Display error message
 */
export function printError(message: string): void {
  console.log(`  ${chalk.red('✗')} ${message}`);
}

/**
 * Display info message
 */
export function printInfo(message: string): void {
  console.log(`  ${chalk.blue('ℹ')} ${message}`);
}

/**
 * Display summary
 */
export function printSummary(result: ScanResult): void {
  const available = result.ports.filter((p) => p.available).length;
  const blocked = result.conflictCount;

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(
    `  ${chalk.white('Summary:')} ${chalk.green(`${available} available`)}, ${blocked > 0 ? chalk.red(`${blocked} blocked`) : chalk.gray('0 blocked')}`
  );
  console.log();
}
