import { expect, test } from "@playwright/test";

const apiBaseURL = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";

async function login(request, email, password) {
  const response = await request.post(`${apiBaseURL}/api/auth/login`, {
    data: { email, password },
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.accessToken).toBeTruthy();
  return payload.accessToken;
}

async function ensureMembershipState(
  request,
  tutorToken,
  classroomId,
  studentEmail,
  status,
) {
  const listResponse = await request.get(
    `${apiBaseURL}/api/classrooms/${classroomId}/memberships?viewerRole=tutor`,
    { headers: { Authorization: `Bearer ${tutorToken}` } },
  );
  expect(listResponse.status()).toBe(200);
  const listPayload = await listResponse.json();
  let membership = listPayload.items.find(
    (item) => item.studentEmail === studentEmail,
  );

  if (!membership) {
    const addResponse = await request.post(
      `${apiBaseURL}/api/classrooms/${classroomId}/memberships`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
        data: { studentEmail },
      },
    );
    expect([200, 201]).toContain(addResponse.status());
    membership = (await addResponse.json()).item;
  }

  if (membership.status !== status) {
    const updateResponse = await request.patch(
      `${apiBaseURL}/api/classrooms/${classroomId}/memberships/${membership.id}`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
        data: { status },
      },
    );
    expect(updateResponse.status()).toBe(200);
    membership = (await updateResponse.json()).item;
  }

  expect(membership.status).toBe(status);
  return membership;
}

async function setCodePulseMembershipStatus(
  request,
  adminToken,
  membershipId,
  status,
) {
  const response = await request.patch(
    `${apiBaseURL}/api/codepulse/memberships/${membershipId}`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status },
    },
  );
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(String(payload.item.status).toLowerCase()).toBe(status);
}

test.describe("US-002.2 enrollment and retention integrity", () => {
  test("adding a valid student succeeds and updates the roster", async ({
    request,
  }) => {
    const tutorToken = await login(request, "tutor@gmail.com", "tutor123");
    await ensureMembershipState(
      request,
      tutorToken,
      "2",
      "student@gmail.com",
      "REVOKED",
    );
    const response = await request.post(
      `${apiBaseURL}/api/classrooms/2/memberships`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
        data: { studentEmail: "student@gmail.com" },
      },
    );

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.item.studentEmail).toBe("student@gmail.com");
    expect(payload.item.status).toBe("ACTIVE");
    expect(payload.reactivated).toBeTruthy();
  });

  test("adding a non-existent student email returns an error", async ({
    request,
  }) => {
    const tutorToken = await login(request, "tutor@gmail.com", "tutor123");

    const response = await request.post(
      `${apiBaseURL}/api/classrooms/2/memberships`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
        data: { studentEmail: "missing.student@example.com" },
      },
    );

    expect(response.status()).toBe(404);
    const payload = await response.json();
    expect(payload.code).toBe("STUDENT_NOT_FOUND");
  });

  test("re-adding a previously revoked student reactivates their membership", async ({
    request,
  }) => {
    const tutorToken = await login(request, "tutor@gmail.com", "tutor123");
    await ensureMembershipState(
      request,
      tutorToken,
      "2",
      "student@gmail.com",
      "REVOKED",
    );
    const response = await request.post(
      `${apiBaseURL}/api/classrooms/2/memberships`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
        data: { studentEmail: "student@gmail.com" },
      },
    );

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.reactivated).toBeTruthy();
    expect(payload.item.studentEmail).toBe("student@gmail.com");
    expect(payload.item.status).toBe("ACTIVE");
  });

  test("revoking membership preserves all previous submissions in the database", async ({
    request,
  }) => {
    const tutorToken = await login(request, "tutor@gmail.com", "tutor123");
    await ensureMembershipState(
      request,
      tutorToken,
      "2",
      "student@gmail.com",
      "ACTIVE",
    );
    const beforeResponse = await request.get(
      `${apiBaseURL}/api/courses/2/submissions?viewerRole=tutor`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
      },
    );
    expect(beforeResponse.status()).toBe(200);
    const beforePayload = await beforeResponse.json();
    expect(beforePayload.items.length).toBeGreaterThan(0);
    const beforeIds = beforePayload.items.map((item) => item.id).sort();

    const membershipsResponse = await request.get(
      `${apiBaseURL}/api/classrooms/2/memberships?viewerRole=tutor`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
      },
    );
    expect(membershipsResponse.status()).toBe(200);
    const membershipPayload = await membershipsResponse.json();
    const targetMembership = membershipPayload.items.find(
      (item) => item.studentEmail === "student@gmail.com",
    );

    expect(targetMembership).toBeTruthy();

    const revokeResponse = await request.patch(
      `${apiBaseURL}/api/classrooms/2/memberships/${targetMembership.id}`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
        data: { status: "REVOKED" },
      },
    );
    expect(revokeResponse.status()).toBe(200);

    const afterResponse = await request.get(
      `${apiBaseURL}/api/courses/2/submissions?viewerRole=tutor`,
      {
        headers: { Authorization: `Bearer ${tutorToken}` },
      },
    );
    expect(afterResponse.status()).toBe(200);
    const afterPayload = await afterResponse.json();
    expect(afterPayload.items.length).toBe(beforePayload.items.length);
    expect(afterPayload.items.map((item) => item.id).sort()).toEqual(beforeIds);
  });

  test("revoked student receives 403 when trying to load the classroom problem list", async ({
    request,
  }) => {
    const adminToken = await login(request, "admin@gmail.com", "admin123");
    await setCodePulseMembershipStatus(
      request,
      adminToken,
      "member-1",
      "active",
    );

    try {
      await setCodePulseMembershipStatus(
        request,
        adminToken,
        "member-1",
        "revoked",
      );

      const studentToken = await login(
        request,
        "student@gmail.com",
        "student123",
      );
      const problemResponse = await request.get(
        `${apiBaseURL}/api/codepulse/classrooms/class-1/problems/problem-1`,
        {
          headers: { Authorization: `Bearer ${studentToken}` },
        },
      );

      expect(problemResponse.status()).toBe(403);
    } finally {
      await setCodePulseMembershipStatus(
        request,
        adminToken,
        "member-1",
        "active",
      );
    }
  });

  test('filters courses by title and ignores letter casing', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:3000'}/login`);
    await page.locator('#email').fill('student@gmail.com');
    await page.locator('#password').fill('student123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/dashboard\/?$/);

    await page
      .getByPlaceholder('Nhập tên khóa học để tìm kiếm...')
      .fill('DATABASE');

    await expect(
      page.getByRole('heading', { name: 'Database System', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Computer Network', exact: true }),
    ).not.toBeVisible();
  });

  test('shows the empty state when a course search has no results', async ({ page }) => {
    await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:3000'}/login`);
    await page.locator('#email').fill('student@gmail.com');
    await page.locator('#password').fill('student123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).toHaveURL(/\/dashboard\/?$/);

    await page.getByPlaceholder('Nhập tên khóa học để tìm kiếm...').fill('Không tồn tại');

    await expect(page.getByText('Không tìm thấy khóa học với từ khóa "Không tồn tại"')).toBeVisible();
  });
});
