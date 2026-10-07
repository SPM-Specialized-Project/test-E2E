# SPM E2E tests

This repository contains Playwright E2E tests for the SPM application. They
exercise a real frontend and API; they do not replace backend unit tests.

## Choose the host

Copy `.env.example` to `.env`. To run against a remote deployment, set
`REMOTE_HOST` to its origin:

```dotenv
REMOTE_HOST=https://your-test-host.example
ALLOW_REMOTE_WRITES=false
```

The same value is used for the web app and API. If those use different origins,
set `BASE_URL` and `API_BASE_URL` separately instead. `.env` is git-ignored, so
you can change the host locally without editing test files. Environment
variables override values in `.env`.

With a remote host configured, Playwright does not start local services. With
no remote host configured, the root Playwright config uses the local frontend
and backend on ports `3000` and `4000`.

## Run tests

```bash
npm ci
npx playwright install chromium
npm test
```

Tests that create or update remote data are skipped unless
`ALLOW_REMOTE_WRITES=true`. Enable them only for a dedicated test deployment
with test accounts; they use the application API rather than editing backend
files. Membership status is restored after those checks. Assignment-version
and LAB workflows may leave test records behind, so use a disposable/staging
environment, not production. US-006 also creates a temporary LIVE LAB and
workspace for its autosave, recovery, snapshot, and conflict acceptance tests;
the cancelled LAB's workspace records remain on the host.

## CI contract

The `SPM-frontend` repository sends a `repository_dispatch` event containing
the exact application commit and staging URL to test. This repository checks
out that commit and runs against the supplied host on its Debian self-hosted
runner with label `test-e2e-local`.

The caller workflow polls this run and exposes the result as the
`E2E (test-E2E runner)` required status check on the `staging -> main` pull
request.
