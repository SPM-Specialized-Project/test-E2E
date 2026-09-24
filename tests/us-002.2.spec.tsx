// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { expect as expectPlaywright, test as playwrightTest } from '@playwright/test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe as describeVitest, expect as expectVitest, it as itVitest, vi } from 'vitest';

const courses = [
  {
    id: 'course-1',
    code: 'CS101',
    title: 'Lập trình cơ bản',
    instructor: 'Nguyễn Văn A',
    stats: { documents: 2, links: 1, assignments: 3 },
    bgImage: '',
    students: [],
    sessionsOrganized: 2,
  },
  {
    id: 'course-2',
    code: 'DB201',
    title: 'Cơ sở dữ liệu',
    instructor: 'Trần Thị B',
    stats: { documents: 4, links: 2, assignments: 1 },
    bgImage: '',
    students: [],
    sessionsOrganized: 4,
  },
];

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => vi.fn(),
}));

vi.mock('@/services/use-data-store', () => ({
  useDataStore: () => courses,
}));

vi.mock('@/stores', () => ({
  useUserStore: () => ({ user: null, setUser: vi.fn() }),
}));

vi.mock('@/components/study-layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/scroll-to-top', () => ({ default: () => null }));
vi.mock('@/components/study-layout/header', () => ({ default: () => null }));
vi.mock('@/components/study-layout/sidebar-desktop', () => ({ default: () => null }));
vi.mock('@/components/study-layout/sidebar-mobile', () => ({ default: () => null }));
vi.mock('@/components/study-layout/footer', () => ({ default: () => null }));

import { DashboardComponent } from '@/features/~_private/~dashboard/~index';

describeVitest('US-002.2 - search courses on dashboard', () => {
  afterEach(() => {
    cleanup();
  });

  itVitest('filters courses by title and ignores letter casing', () => {
    render(<DashboardComponent />);

    fireEvent.change(screen.getByPlaceholderText('Nhập tên khóa học để tìm kiếm...'), {
      target: { value: 'CƠ SỞ' },
    });

    expectVitest(screen.getByText('Cơ sở dữ liệu')).toBeInTheDocument();
    expectVitest(screen.queryByText('Lập trình cơ bản')).not.toBeInTheDocument();
  });

  itVitest('shows an empty-state message when no course matches', () => {
    render(<DashboardComponent />);

    fireEvent.change(screen.getByPlaceholderText('Nhập tên khóa học để tìm kiếm...'), {
      target: { value: 'Không tồn tại' },
    });

    expectVitest(
      screen.getByText('Không tìm thấy khóa học với từ khóa "Không tồn tại"'),
    ).toBeInTheDocument();
    expectVitest(screen.queryByText('Lập trình cơ bản')).not.toBeInTheDocument();
    expectVitest(screen.queryByText('Cơ sở dữ liệu')).not.toBeInTheDocument();
  });
});

const apiBaseURL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const backendDataDir = process.env.BACKEND_DATA_DIR ?? 'C:/Users/NoOne/Documents/PG/SPM-frontend/spm/backend/data';
const membershipsPath = `${backendDataDir}/memberships.json`;

async function loadMemberships() {
  const raw = await fetch(`file://${membershipsPath}`);
  return JSON.parse(await raw.text());
}

async function saveMemberships(records: unknown[]) {
  await fetch(`file://${membershipsPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(records, null, 2),
  });
}

async function setMembershipState(classroomId: string, studentEmail: string, status: string) {
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

async function login(request: Parameters<typeof playwrightTest>[0]['request'], email: string, password: string) {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, {
    data: { email, password },
  });

  expectPlaywright(response.ok()).toBeTruthy();
  const payload = await response.json();
  expectPlaywright(payload.accessToken).toBeTruthy();
  return payload.accessToken as string;
}

playwrightTest.describe('US-002.2 enrollment and retention integrity', () => {
  playwrightTest('adding a valid student succeeds and updates the roster', async ({ request }) => {
    await setMembershipState('2', 'student@gmail.com', 'REVOKED');

    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const response = await request.post(`${apiBaseURL}/api/classrooms/2/memberships`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { studentEmail: 'student@gmail.com' },
    });

    expectPlaywright(response.status()).toBe(200);
    const payload = await response.json();
    expectPlaywright(payload.item.studentEmail).toBe('student@gmail.com');
    expectPlaywright(payload.item.status).toBe('ACTIVE');
    expectPlaywright(payload.reactivated).toBeTruthy();
  });

  playwrightTest('adding a non-existent student email returns an error', async ({ request }) => {
    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');

    const response = await request.post(`${apiBaseURL}/api/classrooms/2/memberships`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { studentEmail: 'missing.student@example.com' },
    });

    expectPlaywright(response.status()).toBe(404);
    const payload = await response.json();
    expectPlaywright(payload.code).toBe('STUDENT_NOT_FOUND');
  });

  playwrightTest('re-adding a previously revoked student reactivates their membership', async ({ request }) => {
    await setMembershipState('2', 'student@gmail.com', 'REVOKED');

    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const response = await request.post(`${apiBaseURL}/api/classrooms/2/memberships`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { studentEmail: 'student@gmail.com' },
    });

    expectPlaywright(response.status()).toBe(200);
    const payload = await response.json();
    expectPlaywright(payload.reactivated).toBeTruthy();
    expectPlaywright(payload.item.studentEmail).toBe('student@gmail.com');
    expectPlaywright(payload.item.status).toBe('ACTIVE');
  });

  playwrightTest('revoking membership preserves all previous submissions in the database', async ({ request }) => {
    await setMembershipState('2', 'student@gmail.com', 'ACTIVE');

    const tutorToken = await login(request, 'tutor@gmail.com', 'tutor123');
    const beforeResponse = await request.get(`${apiBaseURL}/api/courses/2/submissions?viewerRole=tutor`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    expectPlaywright(beforeResponse.status()).toBe(200);
    const beforePayload = await beforeResponse.json();
    expectPlaywright(beforePayload.items.length).toBeGreaterThan(0);
    const beforeIds = beforePayload.items.map((item) => item.id).sort();

    const membershipsResponse = await request.get(`${apiBaseURL}/api/classrooms/2/memberships?viewerRole=tutor`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    expectPlaywright(membershipsResponse.status()).toBe(200);
    const membershipPayload = await membershipsResponse.json();
    const targetMembership = membershipPayload.items.find((item) => item.studentEmail === 'student@gmail.com');

    expectPlaywright(targetMembership).toBeTruthy();

    const revokeResponse = await request.patch(`${apiBaseURL}/api/classrooms/2/memberships/${targetMembership.id}`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
      data: { status: 'REVOKED' },
    });
    expectPlaywright(revokeResponse.status()).toBe(200);

    const afterResponse = await request.get(`${apiBaseURL}/api/courses/2/submissions?viewerRole=tutor`, {
      headers: { Authorization: `Bearer ${tutorToken}` },
    });
    expectPlaywright(afterResponse.status()).toBe(200);
    const afterPayload = await afterResponse.json();
    expectPlaywright(afterPayload.items.length).toBe(beforePayload.items.length);
    expectPlaywright(afterPayload.items.map((item) => item.id).sort()).toEqual(beforeIds);
  });

  playwrightTest('revoked student receives 403 when trying to load the classroom problem list', async ({ request }) => {
    await setMembershipState('1', 'student@gmail.com', 'REVOKED');

    const adminToken = await login(request, 'admin@gmail.com', 'admin123');
    const revokeResponse = await request.patch(`${apiBaseURL}/api/codepulse/memberships/member-1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: 'revoked' },
    });
    expectPlaywright(revokeResponse.status()).toBe(200);

    const studentToken = await login(request, 'student@gmail.com', 'student123');
    const problemResponse = await request.get(`${apiBaseURL}/api/codepulse/classrooms/class-1/problems/problem-1`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });

    expectPlaywright(problemResponse.status()).toBe(403);
  });
});
