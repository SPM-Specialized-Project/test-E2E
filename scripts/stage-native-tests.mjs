import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const applicationRoot = process.env.SPM_E2E_APP_ROOT
  ? path.resolve(process.env.SPM_E2E_APP_ROOT)
  : path.join(repositoryRoot, 'spm');

const mappings = [
  ['tests/US-007.1/execution-verdicts.spec.ts', 'frontend/tests/run-code-sandbox/execution-verdicts.spec.ts'],
  ['tests/US-007.1/sandbox-isolation.spec.ts', 'frontend/tests/run-code-sandbox/sandbox-isolation.spec.ts'],
  ['tests/US-007.2/us-007.2.spec.ts', 'frontend/tests/US-007.2/us-007.2.spec.ts'],
  ['tests/us-008.2/us-008.2.spec.ts', 'backend/test/us-008.2/us-008.2.spec.ts'],
  ['tests/us-009.1/issue-detection.spec.ts', 'tests/us-009.1/issue-detection.spec.ts'],
  ['tests/us-012-3/retention-backup.spec.ts', 'tests/us-012-3/retention-backup.spec.ts'],
  ['tests/US-012.2/admin-operations.spec.ts', 'tests/US-012.2-admin-operations/admin-operations.spec.ts'],
  ['tests/US-012.4/semester-reset.spec.ts', 'tests/US-012.4/semester-reset.spec.ts'],
];

for (const [sourceRelative, destinationRelative] of mappings) {
  const source = path.join(repositoryRoot, sourceRelative);
  const destination = path.join(applicationRoot, destinationRelative);
  try {
    await stat(source);
  } catch {
    throw new Error('Native test source is missing: ' + sourceRelative);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
console.log('Staged ' + mappings.length + ' Node/Vitest files into the checked-out SPM source tree.');