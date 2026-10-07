# US-005.1 Playwright tests

These tests cover student Dashboard authorization, scheduled/live session
access, assigned problem visibility, and isolated workspace state for the
multi-problem practice flow. The tests use the host configured in the root
`.env` file. Local runs create an isolated backend; remote write checks require
`ALLOW_REMOTE_WRITES=true` and leave a cancelled LAB and related workspace
records behind.

## Prerequisites

- Node.js 20 or later
- npm

## Install dependencies

Run from the repository root:

```sh
npm install
```

No browser installation is required: these are API integration tests using
Playwright's `APIRequestContext`.

## Run tests

From `test-E2E`, run the US-005.1 tests:

```sh
npx playwright test --config=tests/us-005.1/playwright.config.ts tests/us-005.1
```

List the discovered tests:

```sh
npx playwright test --list --config=tests/us-005.1/playwright.config.ts
```

Run the backend regression suite:

```sh
npm --prefix ../spm run backend:test
```

## Coverage

- The assigned lecturer can read the manager Dashboard; other roles are denied.
- Unauthenticated users, students without membership, lecturers assigned to
  another classroom, and admins cannot read the Dashboard.
- Scheduled LAB problems are listed but cannot be opened or run until the
  lecturer starts the session and the practice window is active.
- A student can load their saved code, while a student without classroom
  membership cannot access the workspace.
- Workspace code is isolated per assigned problem and persists after saving.
- Lecturers can inspect student workspaces but cannot edit them; admins cannot
  access them.
- Student problem responses do not expose hidden test cases.
