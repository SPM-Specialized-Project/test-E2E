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

export type WorkspaceFixture = {
  studentApi: APIRequestContext;
  workspaceId: string;
  assignmentId: string;
  cleanup: () => Promise<void>;
};

async function login(
  api: APIRequestContext,
  credentials: typeof studentCredentials,
): Promise<string> {
  const response = await api.post('/api/auth/login', { data: credentials });
  expect(response.status(), `Login failed: ${response.status()}`).toBe(200);
  const { accessToken } = await response.json();
  return accessToken as string;
}

export async function createWorkspaceFixture(): Promise<WorkspaceFixture> {
  const api = await playwrightRequest.newContext({ baseURL: apiBaseURL });
  let lecturerApi: APIRequestContext | undefined;
  let studentApi: APIRequestContext | undefined;
  let labId: string | undefined;
  let labStateVersion: number | undefined;

  try {
    const lecturerToken = await login(api, lecturerCredentials);
    lecturerApi = await playwrightRequest.newContext({
      baseURL: apiBaseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${lecturerToken}` },
    });
    const studentToken = await login(api, studentCredentials);
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
    }>;
    const version = versions[0];
    expect(version, 'A published assignment version is required').toBeDefined();

    const startAt = new Date(Date.now() - 60_000).toISOString();
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const createResponse = await lecturerApi.post(
      `/api/codepulse/classrooms/${classroomId}/labs`,
      {
        data: {
          name: `US-006 E2E ${Date.now()}`,
          description: 'Temporary workspace for autosave and snapshot acceptance tests.',
          startAt,
          endAt,
          assignments: [{
            assignmentVersionId: version.id,
            mandatory: true,
            openAt: startAt,
            closeAt: endAt,
          }],
        },
      },
    );
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()).item as {
      id: string;
      stateVersion: number;
      assignments: Array<{ assignmentId: string }>;
    };
    labId = created.id;
    labStateVersion = created.stateVersion;

    const liveResponse = await lecturerApi.patch(
      `/api/codepulse/classrooms/${classroomId}/labs/${encodeURIComponent(labId)}`,
      { data: { status: 'LIVE', expectedStateVersion: labStateVersion } },
    );
    expect(liveResponse.status()).toBe(200);
    const liveLab = (await liveResponse.json()).item as { stateVersion: number };
    labStateVersion = liveLab.stateVersion;

    const labsResponse = await studentApi.get(
      `/api/codepulse/classrooms/${classroomId}/labs`,
    );
    expect(labsResponse.status()).toBe(200);
    const labs = (await labsResponse.json()).items as Array<{
      id: string;
      assignments: Array<{ assignmentId: string; workspaceId: string }>;
    }>;
    const lab = labs.find((item) => item.id === created.id);
    const labAssignment = lab?.assignments.find(
      (item) => item.assignmentId === created.assignments[0].assignmentId,
    );
    expect(labAssignment?.workspaceId, 'Student LAB workspace was not created').toBeTruthy();

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
        await api.dispose();
      }
    };

    return {
      studentApi,
      workspaceId: labAssignment!.workspaceId,
      assignmentId: created.assignments[0].assignmentId,
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
      await api.dispose();
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
  studentApi: APIRequestContext,
  workspaceId: string,
) {
  const response = await studentApi.get(
    `/api/codepulse/workspaces/${encodeURIComponent(workspaceId)}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).item as Record<string, unknown>;
}
