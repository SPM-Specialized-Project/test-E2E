# US-008.1: Official submissions

Run from `test-E2E`:

```powershell
npx playwright test tests/us-008.1/us-008.1.spec.ts
```

The suite creates a temporary LIVE LAB with a published assignment version,
then cancels the LAB after each test. It verifies the submit confirmation
includes the problem and version, that the accepted record captures the
editor's source and server receipt timestamp, that later workspace edits do
not mutate the record, and that retrying with the same `request_key` does not
create a second record.

Remote runs require `ALLOW_REMOTE_WRITES=true` in `test-E2E/.env`; use a
dedicated test host and test account. The application currently accepts LAB
submissions but does not yet expose the confirmation dialog or `request_key`
idempotency behavior, so the corresponding acceptance checks will fail until
those features are implemented. Cancelled LAB workspace records remain on the
host.
