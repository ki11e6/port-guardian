import { describe, it, expect } from 'vitest';
import { buildActionChoices } from '../src/cli-interactive.js';
import type { Blocker } from '../src/types.js';

function makeBlocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    type: 'native',
    pid: 1234,
    processName: 'node',
    isOrphanedDockerProxy: false,
    hasRestartLoop: false,
    suggestedAction: 'kill-process',
    suggestedCommand: 'kill 1234',
    requiresSudo: false,
    safeToAutoKill: true,
    isPermanentFix: true,
    ...overrides,
  };
}

describe('buildActionChoices', () => {
  it('returns kill option for native process', () => {
    const choices = buildActionChoices(makeBlocker());
    expect(choices[0].value).toBe('kill');
    expect(choices[0].name).toContain('PID 1234');
  });

  it('always includes skip and abort', () => {
    const choices = buildActionChoices(makeBlocker());
    const values = choices.map((c) => c.value);
    expect(values).toContain('skip');
    expect(values).toContain('abort');
  });

  it('returns kill for orphaned docker-proxy', () => {
    const choices = buildActionChoices(makeBlocker({ isOrphanedDockerProxy: true }));
    expect(choices[0].value).toBe('kill');
    expect(choices[0].name).toContain('orphaned docker-proxy');
  });

  it('returns stop for docker container without restart:always', () => {
    const choices = buildActionChoices(makeBlocker({
      type: 'docker-container',
      docker: {
        containerName: 'my-app',
        containerId: 'abc123',
        image: 'node:18',
        state: 'running',
        restartPolicy: 'no',
      },
    }));
    expect(choices[0].value).toBe('stop');
    expect(choices[0].name).toContain('Stop container');
  });

  it('returns stop-and-remove first for docker container with restart:always', () => {
    const choices = buildActionChoices(makeBlocker({
      type: 'docker-container',
      docker: {
        containerName: 'my-app',
        containerId: 'abc123',
        image: 'node:18',
        state: 'running',
        restartPolicy: 'always',
      },
    }));
    expect(choices[0].value).toBe('stop-and-remove');
    expect(choices[0].name).toContain('recommended');
    expect(choices[1].value).toBe('stop');
    expect(choices[1].name).toContain('may restart');
  });
});
