# US-005.1 Playwright tests

These tests cover student Dashboard authorization, scheduled/live session
access, assigned problem visibility, and isolated workspace state for the
multi-problem practice flow. The spec starts an isolated backend process with a
temporary data directory; it does not need a separately running backend or
frontend.

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

Run the US-005.1 tests:

```sh
npm run test:e2e
```

Type-check the test and Playwright configuration:

```sh
npm run test:e2e:types
```

Run the backend regression suite:

```sh
npm run backend:test
```

## Coverage

- The assigned lecturer can read the manager Dashboard; students with an active
  classroom membership receive only their student Dashboard view.
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
