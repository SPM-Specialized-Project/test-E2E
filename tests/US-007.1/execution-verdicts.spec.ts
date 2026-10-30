import { describe, expect, it } from 'vitest';

import { createExecutionQueue, executionInput } from '../../../backend/executions.mjs';

const assignment = {
  id: 'problem-v1',
  runtime: 'PYTHON',
  cpuTimeLimitMs: 300,
  memoryLimitMb: 128,
  testCases: [
    { id: 'public-1', input: 'hello', expectedOutput: 'hello', hidden: false },
    { id: 'hidden-1', input: 'secret', expectedOutput: 'secret', hidden: true },
  ],
};

function createQueue(worker: (job: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  const records: Array<Record<string, unknown>> = [];
  let writes = Promise.resolve();

  const queue = createExecutionQueue({
    worker,
    imageId: async () => 'sha256:test-image',
    read: async () => structuredClone(records),
    mutate: (update: (items: Array<Record<string, unknown>>) => void) => {
      writes = writes.then(() => update(records));
      return writes;
    },
  });

  return queue;
}

describe('Run Code execution verdicts', () => {
  it('accepts custom stdin without selecting any test cases', () => {
    expect(executionInput({ mode: 'STDIN', stdin: 'hello custom' }, assignment)).toMatchObject({
      mode: 'STDIN',
      tests: [{ input: 'hello custom' }],
    });
  });

  it('runs public tests only and rejects hidden-test selectors', () => {
    expect(executionInput({}, assignment).tests.map((test: { id: string }) => test.id)).toEqual([
      'public-1',
    ]);
    expect(() => executionInput({ testCaseIds: ['hidden-1'] }, assignment)).toThrow();
  });

  it.each([
    ['SUCCESS', 'SUCCESS'],
    ['COMPILE_ERROR', 'COMPILE_ERROR'],
    ['RUNTIME_ERROR', 'RUNTIME_ERROR'],
    ['TIME_LIMIT_EXCEEDED', 'TIME_LIMIT_EXCEEDED'],
    ['MEMORY_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED'],
    ['INTERNAL_ERROR', 'INTERNAL_ERROR'],
  ])('preserves the %s worker verdict', async (workerStatus, expectedStatus) => {
    const queue = createQueue(async () => ({
      status: workerStatus,
      stdout: '',
      stderr: '',
      exitCode: null,
      runtimeMs: 1,
    }));
    const execution = await queue.enqueue({
      assignment,
      sourceCode: 'print("hello")',
      body: { mode: 'STDIN' },
      ownerEmail: 'student@example.test',
    });
    const result = await execution.completion;

    expect(result.status).toBe(expectedStatus);
    expect(result.state).toBe('FINISHED');
    expect(result.passedCount).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result).not.toHaveProperty('score');
  });

  it('reports worker crashes as Internal Error with no passed tests', async () => {
    const queue = createQueue(async () => {
      throw new Error('worker unavailable');
    });
    const execution = await queue.enqueue({
      assignment,
      sourceCode: 'print("hello")',
      body: {},
      ownerEmail: 'student@example.test',
    });
    const result = await execution.completion;

    expect(result.status).toBe('INTERNAL_ERROR');
    expect(result.passedCount).toBe(0);
    expect(result.results.every((test: { passed: boolean }) => !test.passed)).toBe(true);
    expect(result).not.toHaveProperty('score');
  });
});
