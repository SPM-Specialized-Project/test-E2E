import { request } from '@playwright/test';

import { apiBaseURL, isRemoteHost, remoteWritesAllowed } from './target-host';

export default async function prepareStaging() {
  if (!isRemoteHost) return;

  const api = await request.newContext({ baseURL: apiBaseURL });
  try {
    const login = await api.post('/api/auth/login', {
      data: { email: 'admin@gmail.com', password: 'admin123' },
    });
    if (!login.ok()) throw new Error(`Staging fixture login failed: ${login.status()}`);
    const { accessToken } = await login.json();
    const headers = { Authorization: `Bearer ${accessToken}` };
    const classroomURL = '/api/codepulse/classrooms/class-1';
    const classroomResponse = await api.get(classroomURL, { headers });
    if (!classroomResponse.ok()) {
      throw new Error(`Staging fixture classroom is unavailable: ${classroomResponse.status()}`);
    }
    const { item: classroom } = await classroomResponse.json();
    if (classroom.courseId !== '13') throw new Error('class-1 must belong to the DSA demo course 13.');

    if (classroom.status !== 'ACTIVE') {
      if (!remoteWritesAllowed) {
        throw new Error(`class-1 is ${classroom.status}. Set ALLOW_REMOTE_WRITES=true on the staging test host to prepare the fixture.`);
      }
      const activated = await api.patch(classroomURL, {
        headers, data: { patch: { status: 'ACTIVE' } },
      });
      if (!activated.ok()) throw new Error(`Cannot activate staging demo classroom: ${activated.status()}`);
      if ((await activated.json()).item.status !== 'ACTIVE') {
        throw new Error('Staging demo classroom did not become ACTIVE.');
      }
    }

    if (remoteWritesAllowed) {
      const membership = await api.patch('/api/codepulse/memberships/member-1', {
        headers, data: { status: 'active' },
      });
      if (!membership.ok()) throw new Error(`Cannot prepare the student demo membership: ${membership.status()}`);

      const tutorLogin = await api.post('/api/auth/login', {
        data: { email: 'tutor@gmail.com', password: 'tutor123' },
      });
      if (!tutorLogin.ok()) throw new Error(`Staging tutor fixture login failed: ${tutorLogin.status()}`);
      const tutorHeaders = { Authorization: `Bearer ${(await tutorLogin.json()).accessToken}` };
      for (const [courseId, studentEmail] of [
        ['1', 'student@gmail.com'],
        ['2', 'student@gmail.com'],
        ['2', 'phamvand@student.hcmut.edu.vn'],
      ]) {
        const enrolled = await api.post(`/api/classrooms/${courseId}/memberships`, {
          headers: tutorHeaders, data: { studentEmail },
        });
        if (!enrolled.ok()) {
          throw new Error(`Cannot prepare enrollment in course ${courseId}: ${enrolled.status()}`);
        }
        if ((await enrolled.json()).item.status !== 'ACTIVE') {
          throw new Error(`Demo enrollment in course ${courseId} did not become ACTIVE.`);
        }
      }
    }
    console.log(`Staging fixture ready: class-1 ACTIVE${remoteWritesAllowed ? ' and demo enrollments prepared' : ''}.`);
  } finally {
    await api.dispose();
  }
}
