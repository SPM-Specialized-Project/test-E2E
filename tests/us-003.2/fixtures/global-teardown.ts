import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isRemoteHost } from '../../fixtures/target-host';

export default async function globalTeardown() {
  if (isRemoteHost) return;
  await rm(path.join(os.tmpdir(), 'spm-scrum-63-e2e'), { recursive: true, force: true });
}
