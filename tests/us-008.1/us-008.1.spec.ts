import { expect, request as playwrightRequest, test } from '@playwright/test';
import {
  apiBaseURL,
  isRemoteHost,
  remoteWritesAllowed,
} from '../fixtures/target-host';
import {
  createSubmissionFixture,
  getWorkspace,
  getWorkspaceSubmissions,
  openStudentWorkspace,
  replaceEditorCode,
  type SubmissionFixture,
} from './fixtures/submission-fixture';

test.describe.serial('US-008.1 - Immutable official submissions', () => {
  test.skip(
    isRemoteHost && !remoteWritesAllowed,
    'Submission tests create a temporary LIVE LAB and official records; enable remote writes only on a dedicated test host.',
  );

  let fixture: SubmissionFixture;

  test.beforeEach(async () => {
    fixture = await createSubmissionFixture();
  });

  test.afterEach(async () => {
    await fixture?.cleanup();
  });

  test('submits the exact editor code and preserves that snapshot after workspace edits', async ({ page }) => {
    test.setTimeout(60_000);
    await openStudentWorkspace(page, fixture.problemIndex);
    const submittedSource = 'print("official submission snapshot")';
    await replaceEditorCode(page, submittedSource);

    let submitRequests = 0;
    let submissionRequestBody: Record<string, unknown> | undefined;
    page.on('request', (request) => {
      if (
        request.method() === 'POST'
        && new URL(request.url()).pathname.endsWith(
          `/workspaces/${fixture.workspaceId}/submissions`,
        )
      ) {
        submitRequests += 1;
        submissionRequestBody = request.postDataJSON() as Record<string, unknown>;
      }
    });

    await page
      .getByRole('region', { name: 'Student code workspace' })
      .getByRole('button', { name: 'Official submit' })
      .click();
    const confirmation = page.getByRole('dialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(fixture.assignmentTitle);
    await expect(confirmation).toContainText(new RegExp(`v?${fixture.version}\\b`, 'i'));
    expect(submitRequests).toBe(0);

    const acceptedRequestAt = Date.now();
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(
        `/workspaces/${fixture.workspaceId}/submissions`,
      ),
    );
    await confirmation.getByRole('button', { name: /confirm|submit|nộp/i }).click();
    const response = await responsePromise;
    const responseReceivedAt = Date.now();
    expect(response.status()).toBe(201);
    expect(submitRequests).toBe(1);
    expect(submissionRequestBody?.sourceCode).toBe(submittedSource);
    expect(submissionRequestBody?.requestKey).toBeTruthy();

    const submission = (await response.json()).item as {
      id: string;
      workspaceId: string;
      sourceCode: string;
      assignmentId: string;
      assignmentVersionId: string;
      assignmentVersion: { version: number };
      student: { email: string };
      acceptedAt: string;
    };
    expect(submission.id).toBeTruthy();
    expect(submission.sourceCode).toBe(submittedSource);
    expect(submission.assignmentId).toBe(fixture.assignmentId);
    expect(submission.assignmentVersionId).toBe(fixture.assignmentVersionId);
    expect(submission.assignmentVersion.version).toBe(fixture.version);
    expect(submission.student.email).toBe('student@gmail.com');
    expect(submission.acceptedAt).toBeTruthy();
    const acceptedAt = Date.parse(submission.acceptedAt);
    // The staging API and Windows runner can have slightly different clocks.
    const clockSkewToleranceMs = 5_000;
    expect(acceptedAt).toBeGreaterThanOrEqual(acceptedRequestAt - clockSkewToleranceMs);
    expect(acceptedAt).toBeLessThanOrEqual(responseReceivedAt + clockSkewToleranceMs);

    await expect(page.getByText(/Pending|Judging|GRADED/i)).toBeVisible();
    const submissionsBeforeEdit = await getWorkspaceSubmissions(fixture);
    const storedBeforeEdit = submissionsBeforeEdit.find((item) => item.id === submission.id);
    const immutableSnapshot = {
      id: submission.id,
      workspaceId: fixture.workspaceId,
      sourceCode: submittedSource,
      assignmentId: fixture.assignmentId,
      assignmentVersionId: fixture.assignmentVersionId,
      assignmentVersion: submission.assignmentVersion,
      student: submission.student,
      acceptedAt: submission.acceptedAt,
    };
    expect(storedBeforeEdit).toMatchObject(immutableSnapshot);

    const changedSource = 'print("workspace changed after submission")';
    await replaceEditorCode(page, changedSource);
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(
      /Đã lưu|Saved/i,
      { timeout: 10_000 },
    );
    await expect.poll(async () => (await getWorkspace(fixture)).sourceCode, {
      message: 'Workspace code should be persisted after saving',
      timeout: 10_000,
    }).toBe(changedSource);

    const submissionsAfterEdit = await getWorkspaceSubmissions(fixture);
    expect(submissionsAfterEdit).toHaveLength(submissionsBeforeEdit.length);
    const storedAfterEdit = submissionsAfterEdit.find((item) => item.id === submission.id);
    expect(storedAfterEdit).toMatchObject(immutableSnapshot);
  });

  test('same requestKey and payload returns the original submission without increasing history', async () => {
    const requestKey = `us-008.1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sourceCode = 'print("idempotent submission")';
    const route = `/api/codepulse/workspaces/${encodeURIComponent(fixture.workspaceId)}/submissions`;
    const initialHistory = await getWorkspaceSubmissions(fixture);
    const payload = {
      sourceCode,
      assignmentVersionId: fixture.assignmentVersionId,
      requestKey,
    };

    const firstResponse = await fixture.studentApi.post(route, {
      data: payload,
    });
    expect(firstResponse.status()).toBe(201);
    const firstResult = await firstResponse.json();
    expect(firstResult.created).toBe(true);
    const firstSubmission = firstResult.item as {
      id: string;
      sourceCode: string;
      acceptedAt: string;
    };

    const retryResponse = await fixture.studentApi.post(route, {
      data: payload,
    });
    expect(retryResponse.status()).toBe(200);
    const retryResult = await retryResponse.json();
    expect(retryResult.created).toBe(false);
    const retriedSubmission = retryResult.item as typeof firstSubmission;
    expect(retriedSubmission.id).toBe(firstSubmission.id);
    expect(retriedSubmission.sourceCode).toBe(firstSubmission.sourceCode);
    expect(retriedSubmission.acceptedAt).toBe(firstSubmission.acceptedAt);

    const finalHistory = await getWorkspaceSubmissions(fixture);
    expect(finalHistory).toHaveLength(initialHistory.length + 1);
    expect(finalHistory.filter((item) => item.id === firstSubmission.id)).toHaveLength(1);
  });
});
