import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiBaseURL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const backendDataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'spm',
  'backend',
  'data',
);
const membershipsPath = path.join(backendDataDir, 'memberships.json');

async function loadMemberships() {
  const raw = await readFile(membershipsPath, 'utf8');
  return JSON.parse(raw);
}

async function saveMemberships(records) {
  await writeFile(membershipsPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}

async function setMembershipState(classroomId, studentEmail, status) {
  const records = await loadMemberships();
  const match = records.find(
    (record) => record.classroomId === classroomId && record.studentEmail === studentEmail,
  );

  if (!match) {
    records.push({
      id: `temp-${classroomId}-${studentEmail.replace(/[^a-z0-9]/gi, '')}`,
      classroomId,
      studentId: `temp-${classroomId}`,
      studentName: studentEmail,
      studentEmail,
      status,
      enrolledAt: new Date().toISOString(),
      revokedAt: status === 'REVOKED' ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } else {
    match.status = status;
    match.revokedAt = status === 'REVOKED' ? new Date().toISOString() : null;
    match.updatedAt = new Date().toISOString();
  }

  await saveMemberships(records);
}

async function login(request, email, password) {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, {
    data: { email, password },
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.accessToken).toBeTruthy();
  return payload.accessToken;
}

test.describe('US-002.2 enrollment and retention integrity', () => {
  test('adding a valid student succeeds and updates the roster', async ({ request }) => {
    await setMembershipState('2', 'student@gmail.com', 'REVOKED');

    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const response = await request.post(`${apiBaseURL}/api/classrooms/2/memberships`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { studentEmail: 'student@gmail.com' },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.item.studentEmail).toBe('student@gmail.com');
    expect(payload.item.status).toBe('ACTIVE');
    expect(payload.reactivated).toBeTruthy();
  });

  test('adding a non-existent student email returns an error', async ({ request }) => {
    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');

    const response = await request.post(`${apiBaseURL}/api/classrooms/2/memberships`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { studentEmail: 'missing.student@example.com' },
    });

    expect(response.status()).toBe(404);
    const payload = await response.json();
    expect(payload.code).toBe('STUDENT_NOT_FOUND');
  });

  test('re-adding a previously revoked student reactivates their membership', async ({ request }) => {
    await setMembershipState('2', 'student@gmail.com', 'REVOKED');

    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const response = await request.post(`${apiBaseURL}/api/classrooms/2/memberships`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { studentEmail: 'student@gmail.com' },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.reactivated).toBeTruthy();
    expect(payload.item.studentEmail).toBe('student@gmail.com');
    expect(payload.item.status).toBe('ACTIVE');
  });

  test('revoking membership preserves all previous submissions in the database', async ({ request }) => {
    await setMembershipState('2', 'student@gmail.com', 'ACTIVE');

    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const beforeResponse = await request.get(`${apiBaseURL}/api/courses/2/submissions?viewerRole=tutor`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    expect(beforeResponse.status()).toBe(200);
    const beforePayload = await beforeResponse.json();
    expect(beforePayload.items.length).toBeGreaterThan(0);
    const beforeIds = beforePayload.items.map((item) => item.id).sort();

    const membershipsResponse = await request.get(`${apiBaseURL}/api/classrooms/2/memberships?viewerRole=tutor`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    expect(membershipsResponse.status()).toBe(200);
    const membershipPayload = await membershipsResponse.json();
    const targetMembership = membershipPayload.items.find((item) => item.studentEmail === 'student@gmail.com');

    expect(targetMembership).toBeTruthy();

    const revokeResponse = await request.patch(`${apiBaseURL}/api/classrooms/2/memberships/${targetMembership.id}`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { status: 'REVOKED' },
    });
    expect(revokeResponse.status()).toBe(200);

    const afterResponse = await request.get(`${apiBaseURL}/api/courses/2/submissions?viewerRole=tutor`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    expect(afterResponse.status()).toBe(200);
    const afterPayload = await afterResponse.json();
    expect(afterPayload.items.length).toBe(beforePayload.items.length);
    expect(afterPayload.items.map((item) => item.id).sort()).toEqual(beforeIds);
  });

  test('revoked student receives 403 when trying to load the classroom problem list', async ({ request }) => {
    await setMembershipState('1', 'student@gmail.com', 'REVOKED');

    const adminToken = await login(request, 'admin@gmail.com', 'admin123');
    const revokeResponse = await request.patch(`${apiBaseURL}/api/codepulse/memberships/member-1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'revoked' },
    });
    expect(revokeResponse.status()).toBe(200);

    const studentToken = await login(request, 'student@gmail.com', 'student123');
    const problemResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1/problems/problem-1`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });

    expect(problemResponse.status()).toBe(403);
  });
});
