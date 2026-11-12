import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

const backendDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "backend",
);

type TestBackend = {
  baseUrl: string;
  dataDirectory: string;
  stop: () => Promise<void>;
};

async function startBackend(): Promise<TestBackend> {
  const dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), "spm-us0123-retention-"),
  );
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      BACKEND_PORT: "0",
      BACKEND_DATA_DIRECTORY: dataDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Backend startup timed out.")),
        5000,
      );
      server.once("error", reject);
      server.once("exit", (code) => {
        reject(new Error(`Backend exited before startup (${code}): ${stderr}`));
      });
      server.stdout.on("data", (chunk: Buffer) => {
        const match = chunk.toString().match(/localhost:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
    });

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      dataDirectory,
      stop: async () => {
        if (server.exitCode === null) {
          const exited = new Promise<void>((resolve) =>
            server.once("exit", () => resolve()),
          );
          server.kill();
          await exited;
        }
        await rm(dataDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (server.exitCode === null) {
      server.kill();
    }
    await rm(dataDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function request(
  baseUrl: string,
  route: string,
  token?: string,
  method = "GET",
  body?: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return {
    status: response.status,
    data: (await response.json()) as Record<string, any>,
  };
}

async function login(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const response = await request(
    baseUrl,
    "/api/auth/login",
    undefined,
    "POST",
    {
      email,
      password,
    },
  );
  assert.equal(response.status, 200);
  return response.data.accessToken as string;
}

test("AC-16a/16b: a 60-day-old submission, code and revealed hint remain readable after window close", async () => {
  const backend = await startBackend();

  try {
    const lecturerToken = await login(
      backend.baseUrl,
      "lecturer@gmail.com",
      "lecturer123",
    );
    const studentToken = await login(
      backend.baseUrl,
      "student@gmail.com",
      "student123",
    );
    const now = Date.now();
    const startAt = new Date(now - 60 * 60_000).toISOString();
    const closeAt = new Date(now + 60 * 60_000).toISOString();
    const labRoute = "/api/codepulse/classrooms/class-1/labs";

    const createdLab = await request(
      backend.baseUrl,
      labRoute,
      lecturerToken,
      "POST",
      {
        id: "lab-us0123-retention",
        name: "US-012.3 historical retention",
        startAt,
        endAt: closeAt,
        assignments: [
          {
            assignmentVersionId: "problem-1-v1",
            mandatory: true,
            openAt: startAt,
            closeAt,
          },
        ],
      },
    );
    assert.equal(createdLab.status, 201);

    const liveLab = await request(
      backend.baseUrl,
      `${labRoute}/${createdLab.data.item.id}`,
      lecturerToken,
      "PATCH",
      {
        status: "LIVE",
        expectedStateVersion: createdLab.data.item.stateVersion,
      },
    );
    assert.equal(liveLab.status, 200);

    const studentLabs = await request(backend.baseUrl, labRoute, studentToken);
    const lab = studentLabs.data.items.find(
      (item: { id: string }) => item.id === createdLab.data.item.id,
    );
    assert.ok(
      lab,
      "Student should see the lab while retaining classroom membership.",
    );
    const labAssignment = lab.assignments[0];
    const workspaceId = labAssignment.workspaceId as string;
    const workspaceRoute = `/api/codepulse/workspaces/${workspaceId}`;

    const workspace = await request(
      backend.baseUrl,
      workspaceRoute,
      studentToken,
    );
    assert.equal(workspace.status, 200);
    const hintId = workspace.data.item.problem.hints[0].id as string;

    const saved = await request(
      backend.baseUrl,
      workspaceRoute,
      studentToken,
      "PATCH",
      {
        sourceCode: 'print("kept for the semester")',
        baseRevision: workspace.data.item.revision,
      },
    );
    assert.equal(saved.status, 200);

    const revealed = await request(
      backend.baseUrl,
      `${workspaceRoute}/hints/${hintId}`,
      studentToken,
      "POST",
      {},
    );
    assert.equal(revealed.status, 200);

    const submitted = await request(
      backend.baseUrl,
      `${workspaceRoute}/submissions`,
      studentToken,
      "POST",
      {
        sourceCode: 'print("kept for the semester")',
        assignmentVersionId: "problem-1-v1",
        requestKey: "us0123-retention-60-day-submission",
      },
    );
    assert.equal(submitted.status, 201);

    const execution = await request(
      backend.baseUrl,
      `/api/codepulse/classrooms/class-1/assignments/problem-1/run?labId=${encodeURIComponent(lab.id)}&labAssignmentId=${encodeURIComponent(labAssignment.id)}`,
      studentToken,
      "POST",
      { sourceCode: "print(input())" },
    );
    assert.equal(execution.status, 200);
    assert.ok(execution.data.item.totalCount > 0);

    const historicalAcceptedAt = new Date(
      Date.now() - 60 * 24 * 60 * 60_000,
    ).toISOString();
    const submissionsPath = path.join(
      backend.dataDirectory,
      "submissions.json",
    );
    const submissions = JSON.parse(
      await readFile(submissionsPath, "utf8"),
    ) as Array<{
      id: string;
      acceptedAt: string;
    }>;
    const historicalSubmission = submissions.find(
      (item) => item.id === submitted.data.item.id,
    );
    assert.ok(
      historicalSubmission,
      "Created submission should be present in persistent storage.",
    );
    historicalSubmission.acceptedAt = historicalAcceptedAt;
    await writeFile(
      submissionsPath,
      `${JSON.stringify(submissions, null, 2)}\n`,
      "utf8",
    );

    const closedWindow = await request(
      backend.baseUrl,
      `${labRoute}/${lab.id}/assignments/${labAssignment.id}/practice-window`,
      lecturerToken,
      "PATCH",
      {
        status: "CLOSED",
        expectedVersion: labAssignment.practiceWindowVersion,
      },
    );
    assert.equal(closedWindow.status, 200);

    const historicalSubmissionRead = await request(
      backend.baseUrl,
      `/api/codepulse/submissions/${submitted.data.item.id}`,
      studentToken,
    );
    assert.equal(historicalSubmissionRead.status, 200);
    assert.equal(
      historicalSubmissionRead.data.item.acceptedAt,
      historicalAcceptedAt,
    );
    assert.equal(
      historicalSubmissionRead.data.item.assignmentVersionId,
      "problem-1-v1",
    );
    assert.equal(
      historicalSubmissionRead.data.item.sourceCode,
      'print("kept for the semester")',
    );

    const historicalWorkspaceRead = await request(
      backend.baseUrl,
      workspaceRoute,
      studentToken,
    );
    assert.equal(historicalWorkspaceRead.status, 200);
    assert.equal(
      historicalWorkspaceRead.data.item.sourceCode,
      'print("kept for the semester")',
    );
    assert.equal(
      historicalWorkspaceRead.data.item.executionResult.passedCount,
      execution.data.item.passedCount,
    );
    const retainedHint = historicalWorkspaceRead.data.item.problem.hints.find(
      (hint: { id: string }) => hint.id === hintId,
    );
    assert.equal(retainedHint.revealed, true);
    assert.ok(retainedHint.content);
  } finally {
    await backend.stop();
  }
});

test("AC-16c partial: backup checksum and currently checked classroom/workspace reference verify", async () => {
  const backend = await startBackend();

  try {
    await mkdir(backend.dataDirectory, { recursive: true });
    const collections: Record<string, unknown[]> = {
      "codepulse-terms.json": [{ id: "term-us0123" }],
      "codepulse-classrooms.json": [{ id: "class-us0123" }],
      "codepulse-assignments.json": [
        { id: "assignment-us0123", classroomId: "class-us0123" },
      ],
      "codepulse-workspaces.json": [
        { id: "workspace-us0123", classroomId: "class-us0123" },
      ],
      "codepulse-submissions.json": [
        { id: "submission-us0123", classroomId: "class-us0123" },
      ],
      "codepulse-alerts.json": [],
    };

    await Promise.all(
      Object.entries(collections).map(([filename, records]) =>
        writeFile(
          path.join(backend.dataDirectory, filename),
          `${JSON.stringify(records, null, 2)}\n`,
          "utf8",
        ),
      ),
    );

    const adminToken = await login(
      backend.baseUrl,
      "admin@gmail.com",
      "admin123",
    );
    const created = await request(
      backend.baseUrl,
      "/api/admin/backups",
      adminToken,
      "POST",
      { termId: "term-us0123" },
    );
    assert.equal(created.status, 201);

    const backupRecord = created.data.item;
    const backupPath = path.join(
      backend.dataDirectory,
      "backups",
      backupRecord.filename,
    );
    const backupContent = await readFile(backupPath, "utf8");
    const expectedHash = createHash("sha256")
      .update(backupContent, "utf8")
      .digest("hex");
    assert.equal(backupRecord.sha256Hash, expectedHash);

    const backupData = JSON.parse(backupContent) as {
      tables: Record<string, unknown[]>;
    };
    assert.equal(backupData.tables.classrooms[0].id, "class-us0123");
    assert.equal(backupData.tables.workspaces[0].classroomId, "class-us0123");

    const verified = await request(
      backend.baseUrl,
      `/api/admin/backups/${backupRecord.id}/verify`,
      adminToken,
      "POST",
      {},
    );
    assert.equal(verified.status, 200);
    assert.equal(verified.data.item.checksumMatch, true);
    assert.equal(verified.data.item.referentialIntegrity, true);
    assert.equal(verified.data.item.verified, true);
  } finally {
    await backend.stop();
  }
});

// TODO AC-16c: restore into a clean database and assert all records, foreign keys,
// submission judgments/test results, snapshots, assignment versions and hints.
test.todo(
  "AC-16c: restoring a backup reproduces complete semester data and all relational links",
);

// Immutable CodePulse submissions are persisted in submissions.json, while the
// current backup reads codepulse-submissions.json instead.
test.todo(
  "AC-16c: backup includes immutable CodePulse submissions from submissions.json",
);

// Missing backup files currently fall through a success-shaped verification path.
// Keep this as a TODO until verification returns failure instead of simulating success.
test.todo("AC-16c: a missing or malformed backup must fail verification");
