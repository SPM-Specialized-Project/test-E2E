import { expect, test, type APIRequestContext } from '@playwright/test';

import { lecturerAccount, studentAccount } from './fixtures/accounts';

const apiBaseURL = 'http://127.0.0.1:4100';
const classroomAssignmentsURL = '/api/codepulse/classrooms/class-1/assignments';

type AssignmentVersion = {
  id: string;
  assignmentId: string;
  version: number;
  description: string;
  testCases: Array<{
    id: string;
    input: string;
    expectedOutput: string;
    hidden: boolean;
    weight: number;
  }>;
  comparator: {
    normalizeLineEndings: boolean;
    trimTrailingNewline: boolean;
  };
  usedAt: string | null;
};

async function authenticate(
  playwright: typeof import('playwright-core'),
  request: APIRequestContext,
  account: { email: string; password: string },
): Promise<APIRequestContext> {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, { data: account });
  expect(response.status()).toBe(200);
  const { accessToken } = await response.json() as { accessToken: string };
  return playwright.request.newContext({
    baseURL: apiBaseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
}

test('US-003.2: editing a used assignment creates a new version and keeps the old suite immutable', async ({
  page,
  request,
  playwright,
}) => {
  const lecturerApi = await authenticate(playwright, request, lecturerAccount);
  const studentApi = await authenticate(playwright, request, studentAccount);

  try {
    const assignmentTitle = `US-003.2 immutable version ${Date.now()}`;
    const originalDescription = 'Original version description.';
    const originalTestCases = [
      { id: 'public-v1', input: '2 3', expectedOutput: '5\n', hidden: false, weight: 3, verified: true },
      { id: 'hidden-v1', input: '4 5', expectedOutput: '9\n', hidden: true, weight: 2, verified: true },
    ];
    const createResponse = await lecturerApi.post(classroomAssignmentsURL, {
      data: {
        title: assignmentTitle,
        description: originalDescription,
        constraints: 'Two integers.',
        inputFormat: 'Two integers separated by a space.',
        outputFormat: 'Their sum.',
        cpuTimeLimitMs: 5_000,
        memoryLimitMb: 128,
        runtime: 'PYTHON',
        referenceSolution: 'a, b = map(int, input().split())\nprint(a + b)',
        comparator: { normalizeLineEndings: true, trimTrailingNewline: true },
        testCases: originalTestCases,
      },
    });
    expect(createResponse.status()).toBe(201);
    const { item: createdAssignment } = await createResponse.json() as { item: { id: string } };
    const assignmentId = createdAssignment.id;

    const verifyResponse = await lecturerApi.post(`${classroomAssignmentsURL}/${assignmentId}/verify`);
    expect(verifyResponse.status()).toBe(200);
    const publishResponse = await lecturerApi.post(`${classroomAssignmentsURL}/${assignmentId}/publish`);
    expect(publishResponse.status()).toBe(200);

    const submitResponse = await studentApi.post(`${classroomAssignmentsURL}/${assignmentId}/submissions`, {
      data: { sourceCode: 'a, b = map(int, input().split())\nprint(a + b)' },
    });
    expect(submitResponse.status()).toBe(201);
    const { item: submission } = await submitResponse.json() as {
      item: { assignmentVersionId: string };
    };

    await page.goto('/login');
    await page.getByLabel('Email').fill(lecturerAccount.email);
    await page.getByLabel('Password').fill(lecturerAccount.password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/dashboard/);

    await page.goto('/course/13');
    await expect(page.getByRole('heading', { name: 'DSA LAB', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Terms and classrooms' }).click();
    await page.getByRole('checkbox', { name: 'Chỉnh sửa chế độ' }).check();
    await expect(page.getByText('Assignment authoring')).toBeVisible();

    await page.getByRole('button', { name: new RegExp(assignmentTitle) }).click();
    await page.getByLabel('Description').fill('Edited description for the next version.');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('button', { name: new RegExp(`${assignmentTitle}.*Draft`) })).toBeVisible();

    await page.getByRole('button', { name: 'Verify reference solution' }).click();
    await expect(page.getByText(/Đã verify 2 test case/)).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Assignment đã được publish.')).toBeVisible();

    const versionsResponse = await lecturerApi.get('/api/codepulse/classrooms/class-1/assignment-versions');
    expect(versionsResponse.status()).toBe(200);
    const { items: versions } = await versionsResponse.json() as { items: AssignmentVersion[] };
    const assignmentVersions = versions
      .filter((version) => version.assignmentId === assignmentId)
      .sort((left, right) => left.version - right.version);

    expect(assignmentVersions).toHaveLength(2);
    const [version1, version2] = assignmentVersions;
    expect(submission.assignmentVersionId).toBe(version1.id);
    expect(version1.usedAt).toBeTruthy();
    expect(version1.description).toBe(originalDescription);
    expect(version1.testCases).toEqual(originalTestCases);
    expect(version1.comparator).toEqual({
      normalizeLineEndings: true,
      trimTrailingNewline: true,
    });
    expect(version2.version).toBe(2);
    expect(version2.previousVersionId).toBe(version1.id);
    expect(version2.description).toBe('Edited description for the next version.');
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();

    const historyResponse = await lecturerApi.get(
      `/api/codepulse/classrooms/class-1/assignment-versions/${version1.id}/history`,
    );
    expect(historyResponse.status()).toBe(200);
    const history = await historyResponse.json() as {
      item: AssignmentVersion;
      submissions: Array<{ assignmentVersionId: string }>;
    };
    expect(history.item.testCases).toEqual(originalTestCases);
    expect(history.submissions).toHaveLength(1);
    expect(history.submissions[0].assignmentVersionId).toBe(version1.id);
  } finally {
    await lecturerApi.dispose();
    await studentApi.dispose();
  }
});
