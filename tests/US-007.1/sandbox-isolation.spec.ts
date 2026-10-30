import { describe, expect, it } from 'vitest';

import { dockerArguments } from '../../../backend/sandbox.mjs';

describe('Sandbox isolation configuration', () => {
  it('disables networking and restricts container privileges and resources', () => {
    const args = dockerArguments('execution-test', 'sandbox-image', 128);

    for (const requiredFlag of [
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=32',
      '--memory=128m',
      '--memory-swap=128m',
    ]) {
      expect(args).toContain(requiredFlag);
    }
  });

  it('does not mount host paths or Docker socket into the sandbox', () => {
    const args = dockerArguments('execution-test', 'sandbox-image', 128);

    expect(args.some((arg: string) => ['--privileged', '--volume', '--mount', '-v'].includes(arg))).toBe(
      false,
    );
    expect(args.some((arg: string) => arg.includes('/var/run/docker.sock'))).toBe(false);
  });
});
