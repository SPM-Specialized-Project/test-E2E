import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

try {
  const contents = readFileSync(envFile, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;

    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const configuredHost = process.env.REMOTE_HOST?.trim();
const configuredBaseURL = process.env.BASE_URL?.trim();
const localAppBaseURL = process.env.SPM_E2E_LOCAL_APP_URL?.trim();
const localApiBaseURL = process.env.SPM_E2E_LOCAL_API_URL?.trim();
const localBaseURL = 'http://127.0.0.1:3000';

export const appBaseURL = (
  configuredBaseURL || configuredHost || localAppBaseURL || localBaseURL
).replace(/\/+$/, '');
export const apiBaseURL = (
  process.env.API_BASE_URL?.trim()
  || configuredHost
  || configuredBaseURL
  || localApiBaseURL
  || 'http://127.0.0.1:4000'
).replace(/\/+$/, '');
export const isRemoteHost = !['localhost', '127.0.0.1', '::1'].includes(
  new URL(appBaseURL).hostname,
);
export const remoteWritesAllowed = process.env.ALLOW_REMOTE_WRITES === 'true';
