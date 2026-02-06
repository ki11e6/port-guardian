import { describe, it, expect, vi, afterEach } from 'vitest';
import { printHelp } from '../src/cli-help.js';

describe('printHelp', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints usage information to stdout', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Usage:');
    expect(output).toContain('port-guardian');
  });

  it('includes all commands', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('init');
  });

  it('includes all option flags', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('--force');
    expect(output).toContain('--kill');
    expect(output).toContain('--ci');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--find');
    expect(output).toContain('--json');
    expect(output).toContain('--verbose');
    expect(output).toContain('--help');
    expect(output).toContain('--version');
  });

  it('includes port detection sources', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('.portguardian.yml');
    expect(output).toContain('docker-compose');
    expect(output).toContain('Dockerfile');
  });
});
