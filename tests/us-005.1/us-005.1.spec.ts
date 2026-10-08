import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiBaseURL, isRemoteHost, remoteWritesAllowed } from '../fixtures/target-host';

const backendFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'spm',
  'backend',
  'server.mjs',
);

let backend: ChildProcess | undefined;
let backendUrl: string;
let dataDirectory: string;
let api: APIRequestContext;
let cleanupLab: { id: string; lecturerToken: string; stateVersion: number } | undefined;
const cleanupAssignments: Array<{ id: string; lecturerToken: string }> = [];

async function login(email: string, password: string): Promise<string> {
  const response = await api.post('/api/auth/login', {
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

function apiRequest(
  token: string | undefined,
  route: string,
  method = 'GET',
  data?: unknown,
) {
  return api.fetch(route, {
    method,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    ...(data === undefined ? {} : { data }),
  });
}

test.beforeAll(async () => {
  if (isRemoteHost) {
    backendUrl = apiBaseURL;
    api = await request.newContext({ baseURL: backendUrl });
    return;
  }

  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'spm-us0051-'));
  backend = spawn(process.execPath, [backendFile], {
    env: {
      ...process.env,
      BACKEND_PORT: '0',
      BACKEND_DATA_DIRECTORY: dataDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Backend startup timed out')),
      5_000,
    );
    backend?.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    backend?.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited before startup: ${code}`));
    });
    backend?.stdout?.on('data', (chunk: Buffer) => {
      const match = chunk.toString().match(/localhost:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    });
  });

  backendUrl = `http://127.0.0.1:${port}`;
  api = await request.newContext({ baseURL: backendUrl });
});

test.afterAll(async () => {
  await api?.dispose();
  if (backend && backend.exitCode === null) {
    await new Promise<void>((resolve) => {
      backend?.once('exit', () => resolve());
      backend?.kill();
    });
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test.afterEach(async () => {
  try {
    if (cleanupLab) {
      const response = await apiRequest(
        cleanupLab.lecturerToken,
        `/api/codepulse/classrooms/class-1/labs/${cleanupLab.id}`,
        'PATCH',
        { status: 'CANCELLED', expectedStateVersion: cleanupLab.stateVersion },
      );
      expect(response.status()).toBe(200);
      cleanupLab = undefined;
    }
  } finally {
    for (const assignment of cleanupAssignments.splice(0)) {
      const response = await apiRequest(
        assignment.lecturerToken,
        `/api/codepulse/classrooms/class-1/assignments/${assignment.id}`,
        'DELETE',
      );
      expect.soft(response.status()).toBe(200);
    }
  }
});

test('US-005.1: dashboard permission follows the assigned classroom role', async () => {
  const student = await login('student@gmail.com', 'student123');
  const studentWithoutMembership = await login(
    'student2@gmail.com',
    'student2123',
  );
  const assignedLecturer = await login('lecturer@gmail.com', 'lecturer123');
  const otherLecturer = await login('lecturer2@gmail.com', 'lecturer2123');
  const admin = await login('admin@gmail.com', 'admin123');
  const dashboard = '/api/codepulse/classrooms/class-1/dashboard';

  expect((await apiRequest(undefined, dashboard)).status()).toBe(401);
  const studentResult = await apiRequest(student, dashboard);
  expect(studentResult.status()).toBe(403);
  expect((await apiRequest(studentWithoutMembership, dashboard)).status()).toBe(
    403,
  );
  expect((await apiRequest(otherLecturer, dashboard)).status()).toBe(403);
  expect((await apiRequest(admin, dashboard)).status()).toBe(403);

  const response = await apiRequest(assignedLecturer, dashboard);
  expect(response.status()).toBe(200);
  const result = (await response.json()) as {
    classroom: { id: string; status: string };
    activeMembers: number;
  };
  expect(result.classroom.id).toBe('class-1');
  expect(result.classroom.status).toBe('ACTIVE');
  expect(result.activeMembers).toBeGreaterThan(0);
});

test('US-005.1: student workspaces keep saved code isolated per problem', async () => {
  test.skip(isRemoteHost && !remoteWritesAllowed, 'Set ALLOW_REMOTE_WRITES=true to run remote mutation checks.');
  test.setTimeout(60_000);
  const student = await login('student@gmail.com', 'student123');
  const secondStudent = await login('student2@gmail.com', 'student2123');
  const lecturer = await login('lecturer@gmail.com', 'lecturer123');
  const admin = await login('admin@gmail.com', 'admin123');
  const classroomId = 'class-1';
  const labsRoute = `/api/codepulse/classrooms/${classroomId}/labs`;
  const assignmentsRoute = `/api/codepulse/classrooms/${classroomId}/assignments`;
  const fixtureAssignmentIds: string[] = [];
  for (const index of [1, 2]) {
    const created = await apiRequest(lecturer, assignmentsRoute, 'POST', {
      title: `E2E US-005.1 problem ${index} ${Date.now()}`,
      description: 'Echo one integer to verify workspace isolation.',
      constraints: 'Input contains one integer.',
      inputFormat: 'One integer.',
      outputFormat: 'Print the integer.',
      cpuTimeLimitMs: 1_000,
      memoryLimitMb: 128,
      runtime: 'PYTHON',
      referenceSolution: 'print(input())',
      testCases: [
        { id: `public-${index}`, input: '7', expectedOutput: '7', hidden: false },
        { id: `hidden-${index}`, input: '8', expectedOutput: '8', hidden: true },
      ],
    });
    expect(created.status()).toBe(201);
    const { item } = await created.json();
    fixtureAssignmentIds.push(item.id);
    cleanupAssignments.push({ id: item.id, lecturerToken: lecturer });
    expect((await apiRequest(lecturer, `${assignmentsRoute}/${item.id}/verify`, 'POST')).status()).toBe(200);
    expect((await apiRequest(lecturer, `${assignmentsRoute}/${item.id}/publish`, 'POST')).status()).toBe(200);
  }

  const versionsResponse = await apiRequest(
    lecturer,
    `/api/codepulse/classrooms/${classroomId}/assignment-versions`,
  );
  expect(versionsResponse.status()).toBe(200);
  const versions = (await versionsResponse.json()) as {
    items: Array<{ id: string; assignmentId: string; starterCode?: string }>;
  };
  const selectedVersions = versions.items.filter((version) =>
    fixtureAssignmentIds.includes(version.assignmentId),
  );
  expect(selectedVersions).toHaveLength(2);

  const startAt = new Date(Date.now() - 60_000).toISOString();
  const endAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const createdLabResponse = await apiRequest(
    lecturer,
    labsRoute,
    'POST',
    {
      name: 'US-005.1 workspace isolation',
      startAt,
      endAt,
      assignments: selectedVersions.map((version) => ({
        assignmentVersionId: version.id,
        mandatory: true,
        practiceStartAt: startAt,
        practiceEndAt: endAt,
      })),
    },
  );
  expect(createdLabResponse.status()).toBe(201);
  const createdLab = (await createdLabResponse.json()) as {
    item: { id: string; status: string; stateVersion: number };
  };
  cleanupLab = {
    id: createdLab.item.id,
    lecturerToken: lecturer,
    stateVersion: createdLab.item.stateVersion,
  };

  const liveResponse = await apiRequest(
    lecturer,
    `${labsRoute}/${createdLab.item.id}`,
    'PATCH',
    { status: 'LIVE', expectedStateVersion: createdLab.item.stateVersion },
  );
  expect(liveResponse.status()).toBe(200);
  const liveLab = (await liveResponse.json()).item;
  expect(liveLab.status).toBe('LIVE');
  cleanupLab.stateVersion = liveLab.stateVersion;

  const studentLabsResponse = await apiRequest(student, labsRoute);
  expect(studentLabsResponse.status()).toBe(200);
  const studentLabs = (await studentLabsResponse.json()) as {
    items: Array<{
      id: string;
      assignments: Array<{
        id: string;
        assignmentId: string;
        workspaceId: string;
      }>;
    }>;
  };
  const lab = studentLabs.items.find((item) => item.id === createdLab.item.id);
  expect(lab).toBeDefined();
  expect(lab?.assignments).toHaveLength(2);
  const assignmentList = await apiRequest(
    student,
    `/api/codepulse/classrooms/${classroomId}/assignments`,
  );
  expect(assignmentList.status()).toBe(200);
  const visibleAssignments = (await assignmentList.json()) as {
    items: Array<{ id: string }>;
  };
  expect(
    lab!.assignments.every((assigned) =>
      visibleAssignments.items.some((item) => assigned.assignmentId === item.id),
    ),
  ).toBe(true);
  const unassignedProblem = visibleAssignments.items.find((item) =>
    !lab!.assignments.some((assigned) => assigned.assignmentId === item.id),
  );
  expect(unassignedProblem).toBeDefined();
  expect(
    (await apiRequest(
      student,
      `/api/codepulse/classrooms/${classroomId}/workspace?assignmentId=${unassignedProblem!.id}&labId=${lab!.id}`,
    )).status(),
  ).toBe(404);

  const firstWorkspaceId = lab!.assignments[0].workspaceId;
  const secondWorkspaceId = lab!.assignments[1].workspaceId;
  expect(firstWorkspaceId).not.toBe(secondWorkspaceId);

  const firstWorkspaceRoute = `/api/codepulse/workspaces/${firstWorkspaceId}`;
  const secondWorkspaceRoute = `/api/codepulse/workspaces/${secondWorkspaceId}`;
  const initialFirstWorkspace = await apiRequest(student, firstWorkspaceRoute);
  const initialSecondWorkspace = await apiRequest(student, secondWorkspaceRoute);
  expect(initialFirstWorkspace.status()).toBe(200);
  expect(initialSecondWorkspace.status()).toBe(200);
  const firstWorkspace = (await initialFirstWorkspace.json()).item;
  const secondWorkspace = (await initialSecondWorkspace.json()).item;
  expect(firstWorkspace.sourceCode).toBe(selectedVersions[0].starterCode ?? '');
  expect(secondWorkspace.sourceCode).toBe(selectedVersions[1].starterCode ?? '');
  expect(
    (
      await apiRequest(
        secondStudent,
        `/api/codepulse/classrooms/${classroomId}/workspace?assignmentId=${lab!.assignments[0].assignmentId}&labAssignmentId=${lab!.assignments[0].id}`,
      )
    ).status(),
  ).toBe(403);

  const firstProblemCode = 'print("solution for first problem")';
  const saveResponse = await apiRequest(student, firstWorkspaceRoute, 'PATCH', {
    sourceCode: firstProblemCode,
  });
  expect(saveResponse.status()).toBe(200);

  const savedFirstWorkspace = await apiRequest(student, firstWorkspaceRoute);
  const untouchedSecondWorkspace = await apiRequest(student, secondWorkspaceRoute);
  expect((await savedFirstWorkspace.json()).item.sourceCode).toBe(firstProblemCode);
  expect((await untouchedSecondWorkspace.json()).item.sourceCode).toBe(selectedVersions[1].starterCode ?? '');

  expect((await apiRequest(secondStudent, firstWorkspaceRoute)).status()).toBe(
    403,
  );
  expect((await apiRequest(lecturer, firstWorkspaceRoute)).status()).toBe(200);
  expect(
    (
      await apiRequest(lecturer, firstWorkspaceRoute, 'PATCH', {
        sourceCode: 'lecturer must not edit student code',
      })
    ).status(),
  ).toBe(403);
  expect((await apiRequest(admin, firstWorkspaceRoute)).status()).toBe(403);

  const problemResponse = await apiRequest(
    student,
    `/api/codepulse/classrooms/${classroomId}/problems/${lab!.assignments[0].assignmentId}`,
  );
  expect(problemResponse.status()).toBe(200);
  const problem = (await problemResponse.json()) as {
    item: { testCases: unknown[] };
  };
  expect(problem.item.testCases).toHaveLength(1);
});
