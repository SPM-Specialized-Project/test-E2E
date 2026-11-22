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

The browser suite includes US-006, which exercises unfinished autosave,
recovery, snapshot, and conflict behavior and is expected to report failures
until those product behaviors are implemented.

The password-log check runs a separate copy of the application backend with
a temporary data directory and an automatically assigned port. Set
`SPM_E2E_BACKEND_ROOT` to the backend directory from the application commit
being tested. Alternatively, check out SPM into this repository's ignored
`spm/` directory so the default `spm/backend` path is available. This check
inspects the checked-out backend process; the API and browser tests target
the configured deployment.

Tests that create or update remote data are skipped unless
`ALLOW_REMOTE_WRITES=true`. Enable them only for a dedicated test deployment
with test accounts; they use the application API rather than editing backend
files. Membership status is restored after those checks. Assignment-version
and LAB workflows may leave test records behind, so use a disposable/staging
environment, not production. US-006 also creates a temporary LIVE LAB and
workspace for its autosave, recovery, snapshot, and conflict acceptance tests;
the cancelled LAB's workspace records remain on the host. US-008.1 writes
official submission records which are permanent and cannot be cleaned up by
the test, so run it only against a disposable/staging environment.

When remote writes are enabled, global setup activates the demo classroom
`class-1` in course `13`, restores the primary demo student's membership, and
enrolls the demo students required by the course-list and enrollment tests
through the tutor API. The setup is idempotent.
These are prerequisites for the permission tests. Without remote writes,
setup validates the classroom state and reports an actionable error if it
is not `ACTIVE`. Remote tests run with one worker to avoid overlapping
membership and LAB mutations.

## Debian runner setup

The dispatched full E2E workflow runs on a self-hosted Debian 13 runner registered
to this repository with the labels self-hosted, Linux, X64, and debian-13. The runner
must be online before a dispatch can start. Use a dedicated staging host: remote
fixtures create and update LABs, submissions, memberships, and other test records.

Install Playwright's Linux browser dependencies once, as an administrator, from a
clone of this repository:

~~~bash
npm ci
sudo ./node_modules/.bin/playwright install-deps chromium
~~~

Each workflow run installs the Chromium browser into the runner user's cache. The
workflow requires Node.js 24 and checks that the runner reports Debian 13.

## CI contract

Pull requests run a hosted validation job that checks the portable staging script,
copies each native test fixture into a temporary directory, and lists the Playwright
tests. They do not write to staging.

The SPM-frontend repository sends a repository_dispatch event containing the exact
application commit and staging URL to test. This repository checks out that E2E
revision and the application commit into spm/, then runs the browser, frontend
Vitest, backend Node, and backend Vitest suites on the Debian 13 runner. Each group
is allowed to finish; the summary step fails the job if any group fails. Native test
specs are copied into the checked-out SPM source tree so relative imports resolve.
Manual dispatch accepts an app_ref and staging URL.

The caller stores E2E_DISPATCH_TOKEN in SPM-frontend. It needs permission to dispatch
this repository and read its Actions runs. An HTTP 401 means the caller's stored
token must be replaced there; this repository workflow cannot repair that secret.
The caller polls the dispatched run and exposes its result as the
E2E (test-E2E runner) status check on the staging to main pull request.
