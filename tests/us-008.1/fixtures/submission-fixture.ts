import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { apiBaseURL } from '../../fixtures/target-host';

export const classroomId = 'class-1';
export const studentCredentials = {
  email: 'student@gmail.com',
  password: 'student123',
};

const lecturerCredentials = {
  email: 'lecturer@gmail.com',
  password: 'lecturer123',
};

export type SubmissionFixture = {
  studentApi: APIRequestContext;
  lecturerApi: APIRequestContext;
  labId: string;
  labAssignmentId: string;
  assignmentId: string;
  assignmentVersionId: string;
  workspaceId: string;
  assignmentTitle: string;
  version: number;
  cleanup: () => Promise<void>;
};

async function login(
  api: APIRequestContext,
  credentials: typeof studentCredentials,
) {
  const response = await api.post('/api/auth/login', { data: credentials });
  expect(response.status(), `Login failed: ${response.status()}`).toBe(200);
  return (await response.json()).accessToken as string;
}

export async function createSubmissionFixture(): Promise<SubmissionFixture> {
  const loginApi = await playwrightRequest.newContext({ baseURL: apiBaseURL });
  let lecturerApi: APIRequestContext | undefined;
  let studentApi: APIRequestContext | undefined;
  let labId: string | undefined;
  let labStateVersion: number | undefined;

  try {
    const lecturerToken = await login(loginApi, lecturerCredentials);
    lecturerApi = await playwrightRequest.newContext({
      baseURL: apiBaseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${lecturerToken}` },
    });
    const studentToken = await login(loginApi, studentCredentials);
    studentApi = await playwrightRequest.newContext({
      baseURL: apiBaseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${studentToken}` },
    });

    const versionsResponse = await lecturerApi.get(
      `/api/codepulse/classrooms/${classroomId}/assignment-versions`,
    );
    expect(versionsResponse.status()).toBe(200);
    const versions = (await versionsResponse.json()).items as Array<{
      id: string;
      assignmentId: string;
      version: number;
      title: string;
    }>;
    const version = versions[0];
    expect(version, 'A published assignment version is required').toBeDefined();

    const assignmentResponse = await lecturerApi.get(
      `/api/codepulse/classrooms/${classroomId}/assignments/${encodeURIComponent(version.assignmentId)}`,
    );
    expect(assignmentResponse.status()).toBe(200);
    const assignment = (await assignmentResponse.json()).item as {
      title: string;
    };

    const openAt = new Date(Date.now() - 60_000).toISOString();
    const closeAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const createResponse = await lecturerApi.post(
      `/api/codepulse/classrooms/${classroomId}/labs`,
      {
        data: {
          name: `US-008.1 submissions ${Date.now()}`,
          description: 'Temporary LAB for submission acceptance tests.',
          startAt: openAt,
          endAt: closeAt,
          assignments: [{
            assignmentVersionId: version.id,
            mandatory: true,
            openAt,
            closeAt,
          }],
        },
      },
    );
    expect(createResponse.status()).toBe(201);
    const createdLab = (await createResponse.json()).item as {
      id: string;
      stateVersion: number;
      assignments: Array<{ id: string; assignmentId: string }>;
    };
    labId = createdLab.id;
    labStateVersion = createdLab.stateVersion;
    const labAssignment = createdLab.assignments[0];

    const liveResponse = await lecturerApi.patch(
      `/api/codepulse/classrooms/${classroomId}/labs/${encodeURIComponent(labId)}`,
      { data: { status: 'LIVE', expectedStateVersion: labStateVersion } },
    );
    expect(liveResponse.status()).toBe(200);
    labStateVersion = ((await liveResponse.json()).item as { stateVersion: number }).stateVersion;

    const labsResponse = await studentApi.get(
      `/api/codepulse/classrooms/${classroomId}/labs`,
    );
    expect(labsResponse.status()).toBe(200);
    const labs = (await labsResponse.json()).items as Array<{
      id: string;
      assignments: Array<{
        id: string;
        assignmentId: string;
        assignmentVersionId: string;
        version: number;
        title: string;
        workspaceId: string;
      }>;
    }>;
    const studentLab = labs.find((item) => item.id === labId);
    const studentAssignment = studentLab?.assignments.find(
      (item) => item.id === labAssignment.id,
    );
    expect(studentAssignment?.workspaceId, 'Student workspace was not created').toBeTruthy();

    const cleanup = async () => {
      try {
        if (labId && labStateVersion !== undefined && lecturerApi) {
          const response = await lecturerApi.patch(
            `/api/codepulse/classrooms/${classroomId}/labs/${encodeURIComponent(labId)}`,
            { data: { status: 'CANCELLED', expectedStateVersion: labStateVersion } },
          );
          expect(response.status(), 'Temporary LAB cleanup failed').toBe(200);
        }
      } finally {
        await lecturerApi?.dispose();
        await studentApi?.dispose();
        await loginApi.dispose();
      }
    };

    return {
      studentApi,
      lecturerApi,
      labId,
      labAssignmentId: studentAssignment!.id,
      assignmentId: studentAssignment!.assignmentId,
      assignmentVersionId: studentAssignment!.assignmentVersionId,
      workspaceId: studentAssignment!.workspaceId,
      assignmentTitle: studentAssignment!.title || assignment.title,
      version: studentAssignment!.version,
      cleanup,
    };
  } catch (error) {
    try {
      if (labId && labStateVersion !== undefined && lecturerApi) {
        const response = await lecturerApi.patch(
          `/api/codepulse/classrooms/${classroomId}/labs/${encodeURIComponent(labId)}`,
          { data: { status: 'CANCELLED', expectedStateVersion: labStateVersion } },
        );
        expect(response.status(), 'Temporary LAB cleanup failed').toBe(200);
      }
    } finally {
      await lecturerApi?.dispose();
      await studentApi?.dispose();
      await loginApi.dispose();
    }
    throw error;
  }
}

export async function openStudentWorkspace(page: Page) {
  await page.goto('/login');
  await page.locator('#email').fill(studentCredentials.email);
  await page.locator('#password').fill(studentCredentials.password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await page.goto('/course/13#terms');
  await expect(page.getByRole('heading', { name: 'Problem workspace' })).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
}

export async function replaceEditorCode(page: Page, sourceCode: string) {
  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(sourceCode);
  await expect(editor.locator('.view-lines')).toContainText(sourceCode);
}

export async function getWorkspace(
  fixture: SubmissionFixture,
): Promise<Record<string, unknown>> {
  const response = await fixture.studentApi.get(
    `/api/codepulse/workspaces/${encodeURIComponent(fixture.workspaceId)}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).item as Record<string, unknown>;
}

export async function getSubmissions(fixture: SubmissionFixture) {
  const response = await fixture.studentApi.get(
    `/api/codepulse/classrooms/${classroomId}/labs/${encodeURIComponent(fixture.labId)}/assignments/${encodeURIComponent(fixture.labAssignmentId)}/submissions`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).items as Array<Record<string, unknown>>;
}
