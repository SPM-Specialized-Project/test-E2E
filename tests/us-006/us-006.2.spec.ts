import {
  expect,
  test,
  type BrowserContext,
} from '@playwright/test';
import {
  appBaseURL,
  isRemoteHost,
  remoteWritesAllowed,
} from '../fixtures/target-host';
import {
  createWorkspaceFixture,
  getWorkspace,
  openStudentWorkspace,
  replaceEditorCode,
  type WorkspaceFixture,
} from './fixtures/workspace-fixture';

test.describe('US-006.2 - Run snapshots and conflict handling', () => {
  test.skip(
    isRemoteHost && !remoteWritesAllowed,
    'Remote workspace tests create a temporary LAB; set ALLOW_REMOTE_WRITES=true only on a dedicated test host.',
  );

  let fixture: WorkspaceFixture;

  test.beforeAll(async () => {
    fixture = await createWorkspaceFixture();
  });

  test.afterAll(async () => {
    await fixture?.cleanup();
  });

  test('Run records an immutable source snapshot linked to its run', async ({ page }) => {
    test.setTimeout(60_000);
    await openStudentWorkspace(page);
    const runSource = 'print("source at run time")';
    await replaceEditorCode(page, runSource);

    const runResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(`/assignments/${fixture.assignmentId}/run`),
    );
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const runResponse = await runResponsePromise;
    expect(runResponse.status()).toBe(200);
    const run = (await runResponse.json()).item as { id: string };
    expect(run.id).toBeTruthy();

    await expect.poll(async () => {
      const saved = await getWorkspace(fixture.studentApi, fixture.workspaceId);
      return Array.isArray(saved.snapshots) ? saved.snapshots.length : 0;
    }, { timeout: 10_000 }).toBeGreaterThan(0);
    const afterRun = await getWorkspace(fixture.studentApi, fixture.workspaceId);
    const snapshots = afterRun.snapshots as Array<{
      runId: string;
      sourceCode: string;
    }>;
    const snapshot = snapshots.find((item) => item.runId === run.id);
    expect(snapshot).toBeDefined();
    expect(snapshot?.sourceCode).toBe(runSource);

    await replaceEditorCode(page, 'print("edited after run")');
    const afterEdit = await getWorkspace(fixture.studentApi, fixture.workspaceId);
    const previousSnapshot = (afterEdit.snapshots as typeof snapshots).find(
      (item) => item.runId === run.id,
    );
    expect(previousSnapshot).toEqual(snapshot);
  });

  test('detects stale saves from a second session without discarding its buffer when conflict closes', async ({
    browser,
    page,
  }) => {
    test.setTimeout(60_000);
    const secondContext: BrowserContext = await browser.newContext({ baseURL: appBaseURL });
    const secondPage = await secondContext.newPage();

    try {
      await Promise.all([
        openStudentWorkspace(page),
        openStudentWorkspace(secondPage),
      ]);
      const initialWorkspace = await getWorkspace(fixture.studentApi, fixture.workspaceId);
      expect(typeof initialWorkspace.revision).toBe('number');

      await replaceEditorCode(page, 'print("saved from first session")');
      await expect(page.locator('[aria-live="polite"]').first()).toContainText(
        /Saved|Đã lưu/i,
        { timeout: 10_000 },
      );

      const conflictResponsePromise = secondPage.waitForResponse((response) =>
        response.request().method() === 'PATCH'
        && response.url().includes(`/api/codepulse/workspaces/${fixture.workspaceId}`)
        && response.status() === 409,
      );
      const uncommittedCode = 'print("keep my second-session buffer")';
      await replaceEditorCode(secondPage, uncommittedCode);
      await conflictResponsePromise;
      const conflictDialog = secondPage.getByRole('dialog');
      await expect(conflictDialog).toBeVisible();

      await conflictDialog.getByRole('button', { name: /close|dismiss|cancel|đóng|hủy/i }).click();
      await expect(conflictDialog).toBeHidden();
      await expect(secondPage.locator('.monaco-editor .view-lines')).toContainText(
        uncommittedCode,
      );
    } finally {
      await secondContext.close();
    }
  });
});
