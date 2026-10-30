import { expect, request as playwrightRequest, test } from '@playwright/test';
import {
  apiBaseURL,
  isRemoteHost,
  remoteWritesAllowed,
} from '../fixtures/target-host';
import {
  createSubmissionFixture,
  getSubmissions,
  getWorkspace,
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
    await openStudentWorkspace(page);
    const submittedSource = 'print("official submission snapshot")';
    await replaceEditorCode(page, submittedSource);

    let submitRequests = 0;
    let submissionRequestBody: Record<string, unknown> | undefined;
    page.on('request', (request) => {
      if (
        request.method() === 'POST'
        && new URL(request.url()).pathname.endsWith(
          `/labs/${fixture.labId}/assignments/${fixture.labAssignmentId}/submit`,
        )
      ) {
        submitRequests += 1;
        submissionRequestBody = request.postDataJSON() as Record<string, unknown>;
      }
    });

    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    const confirmation = page.getByRole('dialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(fixture.assignmentTitle);
    await expect(confirmation).toContainText(new RegExp(`v?${fixture.version}\\b`, 'i'));
    expect(submitRequests).toBe(0);

    const acceptedRequestAt = Date.now();
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(
        `/labs/${fixture.labId}/assignments/${fixture.labAssignmentId}/submit`,
      ),
    );
    await confirmation.getByRole('button', { name: /confirm|submit|nộp/i }).click();
    const response = await responsePromise;
    const responseReceivedAt = Date.now();
    expect(response.status()).toBe(201);
    expect(submitRequests).toBe(1);
    expect(submissionRequestBody?.sourceCode).toBe(submittedSource);
    expect(submissionRequestBody?.request_key).toBeTruthy();

    const submission = (await response.json()).item as {
      id: string;
      sourceCode: string;
      assignmentId: string;
      assignmentVersionId: string;
      version: number;
      ownerEmail: string;
      acceptedAt: string;
      submittedAt: string;
    };
    expect(submission.id).toBeTruthy();
    expect(submission.sourceCode).toBe(submittedSource);
    expect(submission.assignmentId).toBe(fixture.assignmentId);
    expect(submission.assignmentVersionId).toBe(fixture.assignmentVersionId);
    expect(submission.version).toBe(fixture.version);
    expect(submission.ownerEmail).toBe('student@gmail.com');
    expect(submission.acceptedAt).toBeTruthy();
    const acceptedAt = Date.parse(submission.acceptedAt);
    expect(acceptedAt).toBeGreaterThanOrEqual(acceptedRequestAt);
    expect(acceptedAt).toBeLessThanOrEqual(responseReceivedAt);

    await expect(page.getByText(/Pending|Judging|GRADED/i)).toBeVisible();
    const submissionsBeforeEdit = await getSubmissions(fixture);
    const storedBeforeEdit = submissionsBeforeEdit.find((item) => item.id === submission.id);
    expect(storedBeforeEdit?.sourceCode).toBe(submittedSource);

    const changedSource = 'print("workspace changed after submission")';
    await replaceEditorCode(page, changedSource);
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(
      /Đã lưu|Saved/i,
      { timeout: 10_000 },
    );
    expect((await getWorkspace(fixture)).sourceCode).toBe(changedSource);

    const submissionsAfterEdit = await getSubmissions(fixture);
    const storedAfterEdit = submissionsAfterEdit.find((item) => item.id === submission.id);
    expect(storedAfterEdit).toEqual(storedBeforeEdit);
    expect(storedAfterEdit?.sourceCode).toBe(submittedSource);
  });

  test('same request_key and payload returns the original submission without increasing history', async () => {
    const requestKey = `us-008.1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sourceCode = 'print("idempotent submission")';
    const route = `/api/codepulse/classrooms/class-1/labs/${encodeURIComponent(fixture.labId)}/assignments/${encodeURIComponent(fixture.labAssignmentId)}/submit`;
    const initialHistory = await getSubmissions(fixture);

    const firstResponse = await fixture.studentApi.post(route, {
      data: { sourceCode, request_key: requestKey },
    });
    expect(firstResponse.status()).toBe(201);
    const firstSubmission = (await firstResponse.json()).item as {
      id: string;
      sourceCode: string;
      acceptedAt: string;
    };

    const retryResponse = await fixture.studentApi.post(route, {
      data: { sourceCode, request_key: requestKey },
    });
    expect(retryResponse.status()).toBe(201);
    const retriedSubmission = (await retryResponse.json()).item as typeof firstSubmission;
    expect(retriedSubmission.id).toBe(firstSubmission.id);
    expect(retriedSubmission.sourceCode).toBe(firstSubmission.sourceCode);
    expect(retriedSubmission.acceptedAt).toBe(firstSubmission.acceptedAt);

    const finalHistory = await getSubmissions(fixture);
    expect(finalHistory).toHaveLength(initialHistory.length + 1);
    expect(finalHistory.filter((item) => item.id === firstSubmission.id)).toHaveLength(1);
  });
});
