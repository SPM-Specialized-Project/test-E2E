import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export default async function globalTeardown() {
  await rm(path.join(os.tmpdir(), 'spm-scrum-63-e2e'), { recursive: true, force: true });
}
