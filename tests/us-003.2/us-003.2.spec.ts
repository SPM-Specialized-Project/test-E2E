import {
  expect,
  request as playwrightRequest,
  test,
  type Page,
} from '@playwright/test';
import {
  apiBaseURL,
  isRemoteHost,
  remoteWritesAllowed,
} from '../fixtures/target-host';

const lecturer = {
  email: 'lecturer@gmail.com',
  password: 'lecturer123',
};
const student = {
  email: 'student@gmail.com',
  password: 'student123',
};
const classroomId = 'class-1';

interface Assignment {
  id: string;
  title: string;
  description: string;
  status: string;
  verificationStatus: string;
  testCases: Array<{ id: string; input: string; expectedOutput: string; verified?: boolean }>;
}

async function authenticate(page: Page, credentials: typeof lecturer) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(credentials.email);
  await page.getByLabel(/password/i).fill(credentials.password);
  await page.getByRole('button', { name: /sign in|đăng nhập/i }).click();
}

async function apiLogin(credentials: typeof lecturer) {
  const api = await playwrightRequest.newContext({ baseURL: apiBaseURL });
  try {
    const response = await api.post('/api/auth/login', { data: credentials });
    expect(response.ok(), `Login failed: ${response.status()}`).toBeTruthy();
    const body = await response.json();
    return body.accessToken as string;
  } finally {
    await api.dispose();
  }
}

test('editing a published assignment requires reverification before republishing', async ({ page }) => {
  test.skip(
    isRemoteHost && !remoteWritesAllowed,
    'Remote write tests require ALLOW_REMOTE_WRITES=true on a dedicated test host.',
  );

  const lecturerToken = await apiLogin(lecturer);
  const lecturerApi = await playwrightRequest.newContext({
    baseURL: apiBaseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${lecturerToken}` },
  });
  const studentToken = await apiLogin(student);
  const studentApi = await playwrightRequest.newContext({
    baseURL: apiBaseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${studentToken}` },
  });
  const suffix = `${Date.now()}`;
  const originalDescription = `Assignment description ${suffix}`;
  const editedDescription = `Edited assignment description ${suffix}`;
  let assignmentId: string | undefined;

  try {
    const createResponse = await lecturerApi.post(
      `/api/codepulse/classrooms/${classroomId}/assignments`,
      {
        data: {
          title: `E2E assignment ${suffix}`,
          description: originalDescription,
          constraints: 'Input contains one integer.',
          inputFormat: 'One integer.',
          outputFormat: 'Print the integer.',
          cpuTimeLimitMs: 1_000,
          memoryLimitMb: 128,
          runtime: 'PYTHON',
          referenceSolution: 'print(input())',
          testCases: [
            { id: `case-${suffix}`, input: '7', expectedOutput: '7' },
          ],
        },
      },
    );
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()).item as Assignment;
    assignmentId = created.id;

    const verifyResponse = await lecturerApi.post(
      `/api/codepulse/classrooms/${classroomId}/assignments/${assignmentId}/verify`,
    );
    expect(verifyResponse.status()).toBe(200);
    expect((await verifyResponse.json()).item.verificationStatus).toBe('VERIFIED');

    const publishResponse = await lecturerApi.post(
      `/api/codepulse/classrooms/${classroomId}/assignments/${assignmentId}/publish`,
    );
    expect(publishResponse.status()).toBe(200);
    expect((await publishResponse.json()).item.status).toBe('PUBLISHED');
    expect(
      (await studentApi.get(
        `/api/codepulse/classrooms/${classroomId}/assignments/${assignmentId}`,
      )).status(),
    ).toBe(200);

    await authenticate(page, lecturer);
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/course/13#terms');
    await page.getByLabel('Chỉnh sửa chế độ').check();
    const assignmentEditor = page.locator('section').filter({ hasText: 'Assignment authoring' }).last();
    await expect(assignmentEditor).toBeVisible();
    await assignmentEditor.getByRole('button', { name: new RegExp(`E2E assignment ${suffix}`) }).click();
    await assignmentEditor.getByLabel(/description|mô tả/i).fill(editedDescription);
    await assignmentEditor.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Đã lưu assignment dưới dạng draft.')).toBeVisible();

    const draftResponse = await lecturerApi.get(
      `/api/codepulse/classrooms/${classroomId}/assignments/${assignmentId}`,
    );
    expect(draftResponse.status()).toBe(200);
    const draft = (await draftResponse.json()).item as Assignment;
    expect(draft.description).toBe(editedDescription);
    expect(draft.status).toBe('DRAFT');
    expect(draft.verificationStatus).toBe('UNVERIFIED');
    expect(
      (await studentApi.get(
        `/api/codepulse/classrooms/${classroomId}/assignments/${assignmentId}`,
      )).status(),
    ).toBe(404);

    await assignmentEditor.getByRole('button', { name: 'Verify reference solution' }).click();
    await expect(page.getByText(/Đã verify 1 test case/)).toBeVisible();
    await assignmentEditor.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Assignment đã được publish.')).toBeVisible();

    const finalResponse = await lecturerApi.get(
      `/api/codepulse/classrooms/${classroomId}/assignments/${assignmentId}`,
    );
    expect(finalResponse.status()).toBe(200);
    const finalAssignment = (await finalResponse.json()).item as Assignment;
    expect(finalAssignment.status).toBe('PUBLISHED');
    expect(finalAssignment.verificationStatus).toBe('VERIFIED');
    expect(finalAssignment.description).toBe(editedDescription);
    expect(finalAssignment.testCases).toEqual([
      expect.objectContaining({
        id: `case-${suffix}`,
        input: '7',
        expectedOutput: '7',
        verified: true,
      }),
    ]);
    expect(
      (await studentApi.get(
        `/api/codepulse/classrooms/${classroomId}/assignments/${assignmentId}`,
      )).status(),
    ).toBe(200);
  } finally {
    if (assignmentId) {
      const deleteResponse = await lecturerApi.delete(
        `/api/codepulse/classrooms/${classroomId}/assignments/${assignmentId}`,
      );
      expect(deleteResponse.ok(), `Assignment cleanup failed: ${deleteResponse.status()}`).toBeTruthy();
    }
    await lecturerApi.dispose();
    await studentApi.dispose();
  }
});
