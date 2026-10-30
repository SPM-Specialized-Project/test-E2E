// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { codePulseApi, type CodePulseExecutionResult } from '../../src/services/codepulse-api';
import { ExecutionConsole, ExecutionPanel } from '../../src/features/~_private/~course/~$id/components/execution-panel';

vi.mock('@/services/codepulse-api', () => ({
  codePulseApi: { listExecutions: vi.fn() },
}));

const execution: CodePulseExecutionResult = {
  id: 'execution-us-007-2',
  state: 'FINISHED',
  status: 'SUCCESS',
  mode: 'STDIN',
  sourceCode: 'print("snapshot")',
  sourceHash: 'snapshot-hash',
  runtime: 'PYTHON',
  assignmentId: 'assignment-us-007-2',
  assignmentVersionId: 'assignment-us-007-2-v1',
  ownerEmail: 'student@example.test',
  stdout: '<script>window.compromised = true</script>',
  stderr: '<img src=x onerror="alert(1)">',
  runtimeMs: 37,
  memoryUsageKb: 16384,
  exitCode: 0,
  executedAt: '2026-10-22T03:00:00Z',
  limits: { cpuTimeLimitMs: 1000, memoryLimitMb: 128, wallTimeLimitMs: 2250 },
};

describe('US-007.2 — Execution Console & History', () => {
  beforeEach(() => {
    vi.mocked(codePulseApi.listExecutions).mockResolvedValue({
      status: 200,
      data: { items: [execution], nextCursor: null },
    });
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('renders stdout and stderr separately as text and displays execution metrics and ID', () => {
    render(createElement(ExecutionConsole, { execution }));

    const stdout = screen.getByRole('region', { name: 'stdout' });
    const stderr = screen.getByRole('region', { name: 'stderr' });

    expect(stdout).toHaveTextContent(execution.stdout);
    expect(stderr).toHaveTextContent(execution.stderr);
    expect(stdout).not.toHaveTextContent(execution.stderr);
    expect(document.querySelector('script, img')).toBeNull();
    expect(screen.getByText('37 ms')).toBeInTheDocument();
    expect(screen.getByText('16.00 MB (16384 KB)')).toBeInTheDocument();
    expect(screen.getByText('execution_id: execution-us-007-2')).toBeInTheDocument();
  });

  it('shows a warning and bounds output when the execution output was truncated', () => {
    render(createElement(ExecutionConsole, {
      execution: { ...execution, outputTruncated: true, stdout: 'x'.repeat(50000) },
    }));

    expect(screen.getByRole('alert')).toHaveTextContent(/Output truncated/);
    expect(screen.getByRole('region', { name: 'stdout' })).not.toHaveTextContent('x'.repeat(32001));
    expect(screen.getByText(/Nội dung hiển thị đã bị cắt/)).toBeInTheDocument();
  });

  it('distinguishes infrastructure failures from student runtime errors', () => {
    const { rerender } = render(createElement(ExecutionConsole, {
      execution: { ...execution, status: 'INTERNAL_ERROR', memoryUsageKb: null, exitCode: null },
    }));

    expect(screen.getByRole('alert')).toHaveTextContent('Hạ tầng thực thi gặp sự cố');
    expect(screen.getByText('Chưa có số đo')).toBeInTheDocument();

    rerender(createElement(ExecutionConsole, {
      execution: { ...execution, status: 'RUNTIME_ERROR' },
    }));

    expect(screen.getByText('Runtime error · Lỗi chương trình')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens the selected history run with its own read-only snapshot and output', async () => {
    const olderExecution = {
      ...execution,
      id: 'execution-us-007-2-older',
      sourceCode: 'print("older snapshot")',
      stdout: 'older output',
      executedAt: '2026-10-22T02:00:00Z',
    };
    vi.mocked(codePulseApi.listExecutions).mockResolvedValue({
      status: 200,
      data: { items: [execution, olderExecution], nextCursor: null },
    });

    render(createElement(ExecutionPanel, { workspaceId: 'workspace-us-007-2' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Execution History' }));
    fireEvent.click(await screen.findByRole('button', { name: /execution-us-007-2-older/ }));

    const snapshot = screen.getByRole('region', { name: 'Execution snapshot' });
    expect(screen.getByRole('textbox', { name: 'Code snapshot' })).toHaveValue(olderExecution.sourceCode);
    expect(screen.getByRole('textbox', { name: 'Code snapshot' })).toHaveAttribute('readonly');
    expect(within(snapshot).getByRole('region', { name: 'stdout' })).toHaveTextContent('older output');
    expect(screen.getByText(`execution_id: ${olderExecution.id}`)).toBeInTheDocument();
  });
});
