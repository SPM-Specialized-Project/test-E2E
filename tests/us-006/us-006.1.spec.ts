import { expect, test } from '@playwright/test';
import {
  isRemoteHost,
  remoteWritesAllowed,
} from '../fixtures/target-host';
import {
  createWorkspaceFixture,
  getWorkspace,
  openStudentWorkspace,
  type WorkspaceFixture,
} from './fixtures/workspace-fixture';

test.describe('US-006.1 - Autosave mechanics and recovery', () => {
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

  test('debounces rapid edits and advances the saved workspace revision', async ({ page }) => {
    test.setTimeout(60_000);
    await openStudentWorkspace(page);

    const startingWorkspace = await getWorkspace(fixture.studentApi, fixture.workspaceId);
    expect(typeof startingWorkspace.revision).toBe('number');
    let saveRequests = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH'
        && request.url().includes(`/api/codepulse/workspaces/${fixture.workspaceId}`)
      ) saveRequests += 1;
    });

    const sourceCode = 'print("debounced autosave")';
    const editor = page.getByRole('textbox', { name: 'Source code' });
    await editor.fill('');
    await editor.pressSequentially(sourceCode, { delay: 5 });

    await expect.poll(() => saveRequests, { timeout: 10_000 }).toBe(1);
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(/Saved|Đã lưu/i);
    await page.waitForTimeout(1_000);
    expect(saveRequests).toBe(1);

    const savedWorkspace = await getWorkspace(fixture.studentApi, fixture.workspaceId);
    expect(savedWorkspace.sourceCode).toBe(sourceCode);
    expect(savedWorkspace.revision).toBeGreaterThan(startingWorkspace.revision as number);
  });

  test('keeps editor text during an outage and reconciles to Saved after reconnect', async ({ page }) => {
    test.setTimeout(60_000);
    await openStudentWorkspace(page);
    const sourceCode = 'print("keep this while offline")';

    await page.context().setOffline(true);
    const editor = page.getByRole('textbox', { name: 'Source code' });
    await editor.fill(sourceCode);
    await expect(editor).toHaveValue(sourceCode);

    await page.context().setOffline(false);
    await expect(page.locator('[aria-live="polite"]').first()).toContainText(
      /Saved|Đã lưu/i,
      { timeout: 15_000 },
    );
    expect((await getWorkspace(fixture.studentApi, fixture.workspaceId)).sourceCode)
      .toBe(sourceCode);
  });
});
