# SPM staging E2E

This repository contains browser smoke tests for the SPM frontend. The tests run against a real frontend and Node.js backend; they do not replace backend unit tests.

## Local run

From the SPM frontend repository, start the backend on port `4000` and the Vite frontend on port `3000`, then run:

```bash
npm ci
npx playwright install chromium
npm test
```

Override `BASE_URL` and `API_BASE_URL` when staging uses different addresses.

## CI contract

The `SPM-frontend` repository sends a `repository_dispatch` event containing the exact application commit to test. This repository checks out that SPM commit, starts an isolated backend/frontend pair, and executes this suite on its own Debian self-hosted runner with label `test-e2e-local`.

The caller workflow polls this run and exposes the result as the `E2E (test-E2E runner)` required status check on the `staging -> main` pull request.
