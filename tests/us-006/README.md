# US-006.1 and US-006.2: Workspace reliability

Run either story independently from `test-E2E`:

```powershell
npx playwright test tests/us-006/us-006.1.spec.ts
npx playwright test tests/us-006/us-006.2.spec.ts
```

US-006.1 checks debounced autosave and revision updates plus offline recovery.
US-006.2 checks run-linked immutable snapshots and stale-save conflict handling
across two student sessions. Each story file creates a temporary LIVE LAB using
the application API and cancels it after the suite. The app currently has
manual saves and does not yet expose workspace revisions, autosave
reconciliation, conflict dialogs, or persisted run snapshots; these acceptance
tests are expected to fail until those behaviors are implemented.

Remote runs require `ALLOW_REMOTE_WRITES=true` in `test-E2E/.env`. Use a
dedicated test deployment and test account only. Cancelling the temporary LAB
does not currently remove its workspace records.
