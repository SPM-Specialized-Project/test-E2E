# US-003.2: Assignment verification lifecycle

This test checks the supported assignment lifecycle: create and publish an
assignment, edit it in the lecturer UI, confirm that the edit returns it to an
unverified draft hidden from students, then verify and publish it again. The
temporary assignment is deleted through the API in the test cleanup.

Run from `test-E2E`:

```powershell
npx playwright test --config tests/us-003.2/playwright.config.mts
```

To target a remote deployment, set `REMOTE_HOST` (or `BASE_URL` and
`API_BASE_URL`) in `test-E2E/.env`. Remote writes are disabled by default; set
`ALLOW_REMOTE_WRITES=true` only for a dedicated test deployment with test
accounts.

The current application edits an assignment in place and does not expose
immutable assignment versions or a version-used state, so this test does not
assert version-history behavior.
