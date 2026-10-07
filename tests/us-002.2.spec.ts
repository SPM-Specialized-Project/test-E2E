import { expect, test } from '@playwright/test';

import { apiBaseURL, appBaseURL, isRemoteHost, remoteWritesAllowed } from './fixtures/target-host';

async function login(request, email, password) {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, {
    data: { email, password },
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.accessToken).toBeTruthy();
  return payload.accessToken;
}

async function findMembership(request, token, classroomId, studentEmail) {
  const response = await request.get(`${apiBaseURL}/api/classrooms/${classroomId}/memberships`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const payload = await response.json();
  const membership = payload.items.find((item) => item.studentEmail === studentEmail);
  expect(membership, `Expected ${studentEmail} to have a membership in classroom ${classroomId}`).toBeTruthy();
  return membership;
}

async function setMembershipStatus(request, token, classroomId, membershipId, status) {
  const response = await request.patch(
    `${apiBaseURL}/api/classrooms/${classroomId}/memberships/${membershipId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { status },
    },
  );
  expect(response.status()).toBe(200);
}

test.describe('US-002.2 enrollment and retention integrity', () => {
  test('adding an already-enrolled student is idempotent', async ({ request }) => {
    test.skip(isRemoteHost && !remoteWritesAllowed, 'Set ALLOW_REMOTE_WRITES=true to run remote mutation checks.');
    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const response = await request.post(`${apiBaseURL}/api/classrooms/2/memberships`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { studentEmail: 'phamvand@student.hcmut.edu.vn' },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.item.studentEmail).toBe('phamvand@student.hcmut.edu.vn');
    expect(payload.item.status).toBe('ACTIVE');
    expect(payload.created).toBe(false);
    expect(payload.reactivated).toBe(false);
  });

  test('adding a non-existent student email returns an error', async ({ request }) => {
    test.skip(isRemoteHost && !remoteWritesAllowed, 'Set ALLOW_REMOTE_WRITES=true to run remote mutation checks.');
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
    test.skip(isRemoteHost && !remoteWritesAllowed, 'Set ALLOW_REMOTE_WRITES=true to run remote mutation checks.');
    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const membership = await findMembership(request, tutorToken, '1', 'student@gmail.com');
    const originalStatus = membership.status;
    await setMembershipStatus(request, tutorToken, '1', membership.id, 'REVOKED');

    try {
      const response = await request.post(`${apiBaseURL}/api/classrooms/1/memberships`, {
        headers: { Authorization: `Bearer ${tutorToken}` },
        data: { studentEmail: 'student@gmail.com' },
      });
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.reactivated).toBe(true);
      expect(payload.item.studentEmail).toBe('student@gmail.com');
      expect(payload.item.status).toBe('ACTIVE');
    } finally {
      await setMembershipStatus(request, tutorToken, '1', membership.id, originalStatus);
    }
  });

  test('revoking membership preserves all previous submissions in the database', async ({ request }) => {
    test.skip(isRemoteHost && !remoteWritesAllowed, 'Set ALLOW_REMOTE_WRITES=true to run remote mutation checks.');
    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const membership = await findMembership(request, tutorToken, '2', 'phamvand@student.hcmut.edu.vn');
    const beforeResponse = await request.get(`${apiBaseURL}/api/courses/2/submissions?viewerRole=tutor`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    expect(beforeResponse.status()).toBe(200);
    const beforePayload = await beforeResponse.json();
    expect(beforePayload.items.length).toBeGreaterThan(0);
    const beforeIds = beforePayload.items.map((item) => item.id).sort();

    await setMembershipStatus(request, tutorToken, '2', membership.id, 'REVOKED');
    try {
      const afterResponse = await request.get(`${apiBaseURL}/api/courses/2/submissions?viewerRole=tutor`, {
        headers: { Authorization: `Bearer ${tutorToken}` },
      });
      expect(afterResponse.status()).toBe(200);
      const afterPayload = await afterResponse.json();
      expect(afterPayload.items.length).toBe(beforePayload.items.length);
      expect(afterPayload.items.map((item) => item.id).sort()).toEqual(beforeIds);
    } finally {
      await setMembershipStatus(request, tutorToken, '2', membership.id, membership.status);
    }
  });

  test('revoked student receives 403 when trying to load the classroom problem list', async ({ request }) => {
    test.skip(isRemoteHost && !remoteWritesAllowed, 'Set ALLOW_REMOTE_WRITES=true to run remote mutation checks.');
    const adminToken = await login(request, 'admin@gmail.com', 'admin123');
    const revokeResponse = await request.patch(`${apiBaseURL}/api/codepulse/memberships/member-1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'revoked' },
    });
    expect(revokeResponse.status()).toBe(200);

    try {
      const studentToken = await login(request, 'student@gmail.com', 'student123');
      const problemResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1/problems/problem-1`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      expect(problemResponse.status()).toBe(403);
    } finally {
      const restoreResponse = await request.patch(`${apiBaseURL}/api/codepulse/memberships/member-1`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { status: 'active' },
      });
      expect(restoreResponse.ok()).toBeTruthy();
    }
  });

  test('filters courses by title and ignores letter casing', async ({ page }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator('#email').fill('student@gmail.com');
    await page.locator('#password').fill('student123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/dashboard\/?$/);

    await page.getByPlaceholder('Nhập tên khóa học để tìm kiếm...').fill('DATABASE');

    await expect(page.getByText('Database System', { exact: true })).toBeVisible();
    await expect(page.getByText('Computer Network', { exact: true })).not.toBeVisible();
  });

  test('shows the empty state when a course search has no results', async ({ page }) => {
    await page.goto(`${appBaseURL}/login`);
    await page.locator('#email').fill('student@gmail.com');
    await page.locator('#password').fill('student123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/dashboard\/?$/);

    await page.getByPlaceholder('Nhập tên khóa học để tìm kiếm...').fill('Không tồn tại');

    await expect(page.getByText('Không tìm thấy khóa học với từ khóa "Không tồn tại"')).toBeVisible();
  });
});
