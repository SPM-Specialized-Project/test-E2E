import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverFile = fileURLToPath(new URL('../../backend/server.mjs', import.meta.url));

let server: ChildProcessWithoutNullStreams;
let dataDirectory: string;
let auditLogsFile: string;
let baseUrl: string;
let adminToken: string;
let studentToken: string;

async function waitForServer(process: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Backend startup timed out. ${output}`)), 10_000);
    const onOutput = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };

    process.stdout.on('data', onOutput);
    process.stderr.on('data', onOutput);
    process.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited before startup (code ${code}). ${output}`));
    });
  });
}

async function request(
  route: string,
  token?: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected JSON object from ${route}`);
  }
  return { status: response.status, data: data as Record<string, unknown> };
}

async function login(email: string, password: string): Promise<string> {
  const response = await request('/api/auth/login', undefined, 'POST', { email, password });
  expect(response.status).toBe(200);
  expect(typeof response.data.accessToken).toBe('string');
  return response.data.accessToken as string;
}

beforeAll(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'us-012-2-admin-operations-'));
  auditLogsFile = path.join(dataDirectory, 'codepulse-audit-logs.json');
  server = spawn(process.execPath, [serverFile], {
    env: { ...process.env, BACKEND_PORT: '0', BACKEND_DATA_DIRECTORY: dataDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  baseUrl = await waitForServer(server);
  adminToken = await login('admin@gmail.com', 'admin123');
  studentToken = await login('student@gmail.com', 'student123');
});

afterAll(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

describe('US-012.2 Admin Operations API', () => {
  it('TC-0122-API-01: returns health metrics with an update timestamp', async () => {
    const response = await request('/api/admin/operations/health', adminToken);
    expect(response.status).toBe(200);

    const health = response.data.item as {
      queueLength: number;
      runningExecutions: number;
      aiAssessmentQueue: number;
      workerStatus: { totalWorkers: number; activeWorkers: number; idleWorkers: number; poolHealth: string };
      latency: { p50Ms: number; p95Ms: number };
      errorRate: { percentage: number; status: string };
      timestamp: string;
    };
    expect(Number.isInteger(health.queueLength)).toBe(true);
    expect(Number.isInteger(health.runningExecutions)).toBe(true);
    expect(Number.isInteger(health.aiAssessmentQueue)).toBe(true);
    expect(health.workerStatus.totalWorkers).toBeGreaterThan(0);
    expect(health.workerStatus.activeWorkers + health.workerStatus.idleWorkers).toBe(health.workerStatus.totalWorkers);
    expect(health.latency.p50Ms).toBeGreaterThanOrEqual(0);
    expect(health.latency.p95Ms).toBeGreaterThanOrEqual(health.latency.p50Ms);
    expect(health.errorRate.percentage).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });

  it('TC-0122-AUTH-01: denies student access to health, trace, and audit APIs', async () => {
    const responses = await Promise.all([
      request('/api/admin/operations/health', studentToken),
      request('/api/admin/operations/traces/req-sample-01', studentToken),
      request('/api/admin/operations/audit-logs', studentToken),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
  });

  it('TC-0122-TRACE-01: returns the request lifecycle with sensitive trace fields redacted', async () => {
    const response = await request('/api/admin/operations/traces/exec-cf-552', adminToken);
    expect(response.status).toBe(200);

    const trace = response.data.item as {
      requestId: string;
      events: Array<{ stage: string; payload: Record<string, unknown> }>;
    };
    expect(trace.requestId).toBe('exec-cf-552');
    expect(trace.events.map((event) => event.stage)).toEqual(['RECEIVED', 'DISPATCHED', 'EXECUTED', 'RECORDED']);
    expect(trace.events[0].payload.sourceCode).toBe('[REDACTED_STUDENT_CODE]');
    expect(trace.events[0].payload.token).toBe('[REDACTED]');

    const executedEvent = trace.events.find((event) => event.stage === 'EXECUTED');
    const hiddenCase = (executedEvent?.payload.testCases as Array<Record<string, unknown>>).find(
      (testCase) => testCase.hidden === true,
    );
    expect(hiddenCase?.input).toBe('[REDACTED_INPUT]');
    expect(hiddenCase?.expectedOutput).toBe('[REDACTED_OUTPUT]');
  });

  it('TC-0122-TRACE-02: reports an unknown request ID instead of inventing a trace', async () => {
    const missingRequestId = `missing-us0122-${Date.now()}`;
    const response = await request(
      `/api/admin/operations/traces/${encodeURIComponent(missingRequestId)}`,
      adminToken,
    );
    expect(response.status).toBe(404);
  });

  it('TC-0122-PRIV-01: redacts secrets from audit log details', async () => {
    const sentinels = {
      password: 'US0122-PLAIN-PASSWORD',
      token: 'US0122-PLAIN-TOKEN',
      sourceCode: 'US0122-RAW-STUDENT-SOURCE',
      hiddenTest: 'US0122-HIDDEN-TEST-SECRET',
    };
    const fixture = [{
      id: 'audit-us0122-redaction',
      actor: 'admin@example.test',
      action: 'TEST_REDACTION',
      target: 'fixture',
      timestamp: new Date().toISOString(),
      requestId: 'req-us0122-redaction',
      result: 'SUCCESS',
      details: Object.values(sentinels).join(' '),
    }];

    try {
      await writeFile(auditLogsFile, JSON.stringify(fixture), 'utf8');
      const response = await request('/api/admin/operations/audit-logs', adminToken);
      expect(response.status).toBe(200);
      const serialized = JSON.stringify(response.data);
      for (const secret of Object.values(sentinels)) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      await rm(auditLogsFile, { force: true });
    }
  });

  it('TC-0122-AUDIT-01: exposes no API to edit or delete audit records', async () => {
    const original = {
      id: 'audit-us0122-immutable',
      actor: 'admin@example.test',
      action: 'TEST_IMMUTABLE',
      target: 'fixture',
      timestamp: '2026-01-01T00:00:00.000Z',
      requestId: 'req-us0122-immutable',
      result: 'SUCCESS',
      details: 'Immutable audit fixture.',
    };
    try {
      await writeFile(auditLogsFile, JSON.stringify([original]), 'utf8');
      const recordUrl = `/api/admin/operations/audit-logs/${encodeURIComponent(original.id)}`;

      expect((await request(recordUrl, adminToken, 'PUT', { details: 'modified' })).status).toBe(404);
      expect((await request(recordUrl, adminToken, 'DELETE')).status).toBe(404);

      const afterResponse = await request('/api/admin/operations/audit-logs', adminToken);
      const after = (afterResponse.data.items as Array<Record<string, unknown>>)
        .find((log) => log.id === original.id);
      expect(after).toEqual(original);
    } finally {
      await rm(auditLogsFile, { force: true });
    }
  });
});
