// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => vi.fn(),
}));

vi.mock('@/services/use-data-store', () => ({
  useDataStore: () => [
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
  ],
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

describe('US-002.1 - dashboard course list', () => {
  it('displays the dashboard and the available course', () => {
    render(<DashboardComponent />);

    expect(screen.getByRole('heading', { name: 'Khóa học' })).toBeInTheDocument();
    expect(screen.getByText('Danh sách khóa học của bạn')).toBeInTheDocument();
    expect(screen.getByText('Lập trình cơ bản')).toBeInTheDocument();
    expect(screen.getByText('CS101')).toBeInTheDocument();
  });
});