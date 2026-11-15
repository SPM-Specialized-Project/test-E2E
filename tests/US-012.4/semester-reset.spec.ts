import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
const termId = 'term-2026-1';
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function startBackend(t) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'spm-us0124-'));
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: backendDirectory,
    env: { ...process.env, BACKEND_PORT: '0', BACKEND_DATA_DIRECTORY: dataDirectory },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  t.after(async () => {
    if (server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => server.once('exit', resolve));
    }
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Backend startup timed out.')), 5_000);
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited before startup: ${code}`));
    });
    server.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
  });

  return { baseUrl: `http://127.0.0.1:${port}/api`, dataDirectory };
}

async function request(baseUrl, route, token, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

async function login(baseUrl, email, password) {
  const response = await request(baseUrl, '/auth/login', null, 'POST', { email, password });
  assert.equal(response.status, 200);
  return response.data.accessToken;
}

async function confirmBoundaryAndEndTerm(baseUrl, admin) {
  const result = await request(baseUrl, `/codepulse/terms/${termId}`, admin, 'PATCH', {
    patch: {
      status: 'ENDED',
      startDate: '2019-01-01',
      endDate: '2020-01-01',
      resetDate: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  assert.equal(result.status, 200);
}

test('AC-16d: reset requires admin approval and the confirmed boundary', async (t) => {
  const { baseUrl } = await startBackend(t);
  const admin = await login(baseUrl, 'admin@gmail.com', 'admin123');
  const student = await login(baseUrl, 'student@gmail.com', 'student123');

  const unauthorized = await request(baseUrl, `/codepulse/terms/${termId}/reset/start`, student, 'POST');
  assert.equal(unauthorized.status, 403);

  const ended = await request(baseUrl, `/codepulse/terms/${termId}`, admin, 'PATCH', {
    patch: {
      status: 'ENDED',
      startDate: '2019-01-01',
      endDate: '2020-01-01',
      resetDate: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  assert.equal(ended.status, 200);

  const beforeBoundary = await request(baseUrl, `/codepulse/terms/${termId}/reset/start`, admin, 'POST');
  assert.equal(beforeBoundary.status, 409);
  assert.equal(beforeBoundary.data.code, 'RESET_BOUNDARY_NOT_REACHED');

  await confirmBoundaryAndEndTerm(baseUrl, admin);
  const started = await request(baseUrl, `/codepulse/terms/${termId}/reset/start`, admin, 'POST');
  assert.equal(started.status, 200);
  assert.equal(started.data.item.status, 'RESETTING');

  const blockedSubmission = await request(
    baseUrl,
    '/codepulse/workspaces/workspace-1/submissions',
    student,
    'POST',
    { sourceCode: 'print("must not be accepted")', requestKey: 'us0124-barrier-001' },
  );
  assert.equal(blockedSubmission.status, 409);
  assert.equal(blockedSubmission.data.code, 'TERM_RESET_IN_PROGRESS');
});

test('AC-16e/f: purge is reconciled, audited and retains reusable assignment versions', async (t) => {
  const { baseUrl, dataDirectory } = await startBackend(t);
  const admin = await login(baseUrl, 'admin@gmail.com', 'admin123');
  const lecturer = await login(baseUrl, 'lecturer@gmail.com', 'lecturer123');
  const student = await login(baseUrl, 'student@gmail.com', 'student123');

  const workspace = await request(baseUrl, '/codepulse/workspaces/workspace-1', student);
  assert.equal(workspace.status, 200);
  const saved = await request(baseUrl, '/codepulse/workspaces/workspace-1', student, 'PATCH', {
    sourceCode: 'print("personal term data")',
    baseRevision: workspace.data.item.revision,
  });
  assert.equal(saved.status, 200);

  const versionsBefore = await request(baseUrl, '/codepulse/classrooms/class-1/assignment-versions', lecturer);
  assert.equal(versionsBefore.status, 200);
  const workspacesBefore = JSON.parse(await readFile(path.join(dataDirectory, 'codepulse-workspaces.json'), 'utf8'));
  const snapshotsBefore = JSON.parse(await readFile(path.join(dataDirectory, 'codepulse-snapshots.json'), 'utf8'));
  const purgedWorkspaces = workspacesBefore.filter((item) => item.termId === termId || item.classroomId === 'class-1');
  const purgedWorkspaceIds = new Set(purgedWorkspaces.map((item) => item.id));
  const expectedWorkspaceCount = purgedWorkspaces.length;
  const expectedSnapshotCount = snapshotsBefore.filter((item) =>
    item.termId === termId || item.classroomId === 'class-1' || purgedWorkspaceIds.has(item.workspaceId)).length;

  await confirmBoundaryAndEndTerm(baseUrl, admin);
  const started = await request(baseUrl, `/codepulse/terms/${termId}/reset/start`, admin, 'POST');
  assert.equal(started.status, 200);
  const executed = await request(baseUrl, `/codepulse/terms/${termId}/reset/execute`, admin, 'POST');
  assert.equal(executed.status, 200);
  assert.equal(executed.data.item.status, 'RESETDONE');

  const record = executed.data.resetRecord;
  assert.equal(record.status, 'COMPLETE');
  assert.equal(record.immutable, true);
  assert.equal(record.executedBy, 'admin@gmail.com');
  assert.ok(Number.isFinite(Date.parse(record.executedAt)));
  assert.ok(Number.isFinite(Date.parse(record.completedAt)));
  assert.ok(Date.parse(record.completedAt) >= Date.parse(record.executedAt));
  assert.equal(record.affectedRowCounts.workspaces, expectedWorkspaceCount);
  assert.equal(record.affectedRowCounts.snapshots, expectedSnapshotCount);
  assert.ok(Object.values(record.reconciliation).every(Boolean));

  const purgedWorkspace = await request(baseUrl, '/codepulse/workspaces/workspace-1', student);
  assert.equal(purgedWorkspace.status, 404);
  const workspacesAfter = JSON.parse(await readFile(path.join(dataDirectory, 'codepulse-workspaces.json'), 'utf8'));
  const snapshotsAfter = JSON.parse(await readFile(path.join(dataDirectory, 'codepulse-snapshots.json'), 'utf8'));
  assert.equal(workspacesAfter.some((item) => item.termId === termId), false);
  assert.equal(snapshotsAfter.some((item) => item.termId === termId), false);

  const versionsAfter = await request(baseUrl, '/codepulse/classrooms/class-1/assignment-versions', lecturer);
  assert.deepEqual(versionsAfter.data.items, versionsBefore.data.items);
  const records = await request(baseUrl, `/codepulse/terms/${termId}/reset-records`, lecturer);
  assert.equal(records.status, 200);
  assert.ok(records.data.items.some((item) => item.id === record.id));

  const acknowledgement = await request(
    baseUrl,
    `/codepulse/terms/${termId}/reset-records/${record.id}/acknowledge`,
    lecturer,
    'POST',
  );
  assert.equal(acknowledgement.status, 200);
  assert.ok(acknowledgement.data.item.acknowledgements.some((item) => item.acknowledgedBy === 'lecturer@gmail.com'));
});

test.todo('AC-16e: keep the term incomplete and record an error if COMPLETE ResetRecord persistence fails');

test('AC-16d: in-flight runner and assessment work must finish before purge', async () => {
  const { createExecutionQueue } = await import('../../backend/executions.mjs');
  let releaseRunner;
  const runnerGate = new Promise((resolve) => { releaseRunner = resolve; });
  let runnerStarted;
  const runnerStartedSignal = new Promise((resolve) => { runnerStarted = resolve; });
  let releaseAssessment;
  const assessmentGate = new Promise((resolve) => { releaseAssessment = resolve; });
  let assessmentStarted;
  const assessmentStartedSignal = new Promise((resolve) => { assessmentStarted = resolve; });
  let writer = Promise.resolve();
  const records = [];
  const queue = createExecutionQueue({
    worker: async () => {
      runnerStarted();
      await runnerGate;
      return { status: 'SUCCESS', stdout: 'ok', stderr: '', exitCode: 0, runtimeMs: 1 };
    },
    imageId: async () => 'sha256:fixture',
    read: async () => structuredClone(records),
    mutate: (callback) => {
      writer = writer.then(() => callback(records));
      return writer;
    },
  });
  const assignment = {
    id: 'version-1',
    runtime: 'PYTHON',
    cpuTimeLimitMs: 100,
    memoryLimitMb: 64,
    comparator: {},
    testCases: [{ id: 'public-1', input: '', expectedOutput: 'ok', hidden: false }],
  };
  const run = await queue.enqueue({
    assignment,
    sourceCode: 'print("ok")',
    body: {},
    ownerEmail: 'student@gmail.com',
    termId,
  });
  await runnerStartedSignal;
  const assessment = queue.runTermTask(termId, async () => {
    assessmentStarted();
    await assessmentGate;
    return 'assessment-finished';
  });
  await assessmentStartedSignal;

  const drain = queue.drainTerm(termId);
  await assert.rejects(
    queue.enqueue({ assignment, sourceCode: 'print("late")', body: {}, ownerEmail: 'student@gmail.com', termId }),
    { code: 'TERM_RESET_IN_PROGRESS' },
  );
  let drained = false;
  void drain.then(() => { drained = true; });
  await wait(0);
  assert.equal(drained, false);

  releaseRunner();
  releaseAssessment();
  await run.completion;
  assert.equal(await assessment, 'assessment-finished');
  await drain;
  assert.equal(drained, true);
  assert.equal((await queue.list()).every((item) => item.state === 'FINISHED'), true);
});
