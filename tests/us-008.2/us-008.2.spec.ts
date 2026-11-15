import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGradingQueue,
  evaluateSubmission,
  GradingInfrastructureError,
  lecturerJudgmentView,
  studentJudgmentView,
} from '../../grading.mjs';

const imageId = async () => `sha256:${'a'.repeat(64)}`;
const success = (stdout) => ({
  status: 'SUCCESS',
  stdout,
  stderr: '',
  runtimeMs: 5,
  memoryUsageKb: 1024,
  outputTruncated: false,
  exitCode: 0,
});
const batch = (results) => ({ status: 'SUCCESS', results });
const submission = {
  kind: 'CODE_SUBMISSION',
  id: 'submission-us-008.2',
  assignmentId: 'assignment',
  assignmentVersionId: 'assignment-v1',
  sourceCode: 'immutable source',
  status: 'PENDING',
  gradingAttempts: [],
};
const version = (testCases) => ({
  id: 'assignment-v1',
  assignmentId: 'assignment',
  runtime: 'PYTHON',
  cpuTimeLimitMs: 1_000,
  memoryLimitMb: 128,
  comparator: { normalizeLineEndings: true, trimTrailingNewline: true },
  testCases,
});
const memoryStore = (initial = []) => {
  let records = structuredClone(initial);
  return {
    read: async () => structuredClone(records),
    mutate: async (callback) => {
      const value = await callback(records);
      return structuredClone(value);
    },
    value: () => structuredClone(records),
  };
};

test('[TEST] Accepted: all tests pass and award full marks', async () => {
  const result = await evaluateSubmission({
    submission,
    assignmentVersion: version([
      { id: 'test-1', input: 'a', expectedOutput: 'a', weight: 40 },
      { id: 'test-2', input: 'b', expectedOutput: 'b', weight: 60 },
    ]),
    judgmentId: 'judgment-accepted',
    imageId,
    runner: async ({ tests }) => batch(tests.map(({ input }) => success(input))),
  });

  assert.equal(result.verdict, 'ACCEPTED');
  assert.equal(result.score, 100);
  assert.equal(result.passedCount, 2);
  assert.equal(result.failedCount, 0);
});

test('[TEST] Wrong Answer: award partial credit and retain public feedback', async () => {
  const testCases = Array.from({ length: 5 }, (_, index) => ({
    id: `test-${index + 1}`,
    input: `input-${index + 1}`,
    expectedOutput: `expected-${index + 1}`,
    hidden: index === 4,
    weight: 20,
  }));
  const result = await evaluateSubmission({
    submission,
    assignmentVersion: version(testCases),
    judgmentId: 'judgment-partial',
    imageId,
    runner: async ({ tests }) => batch(tests.map(({ input }, index) => success(
      index < 3 ? `expected-${index + 1}` : `actual-${index + 1}`,
    ))),
  });
  const publicFeedback = result.testResults.find(({ hidden }) => !hidden);

  assert.equal(result.verdict, 'WRONG_ANSWER');
  assert.equal(result.score, 60);
  assert.equal(result.passedCount, 3);
  assert.equal(result.failedCount, 2);
  assert.deepEqual(
    [publicFeedback.input, publicFeedback.expectedOutput, publicFeedback.actualOutput, publicFeedback.verdict],
    ['input-1', 'expected-1', 'expected-1', 'PASSED'],
  );

  const allFailed = await evaluateSubmission({
    submission,
    assignmentVersion: version(testCases),
    judgmentId: 'judgment-zero',
    imageId,
    runner: async ({ tests }) => batch(tests.map(() => success('wrong'))),
  });
  assert.equal(allFailed.score, 0);
  assert.equal(allFailed.verdict, 'WRONG_ANSWER');
});

test('[TEST] Compile Error: stop test execution and record a valid zero score', async () => {
  let executionCount = 0;
  const result = await evaluateSubmission({
    submission,
    assignmentVersion: version([
      { id: 'test-1', input: 'a', expectedOutput: 'a', weight: 1 },
      { id: 'test-2', input: 'b', expectedOutput: 'b', weight: 1 },
    ]),
    judgmentId: 'judgment-compile-error',
    imageId,
    runner: async () => {
      executionCount += 1;
      return { ...success(''), status: 'COMPILE_ERROR', stderr: 'syntax error', exitCode: 1 };
    },
  });

  assert.equal(executionCount, 1);
  assert.equal(result.verdict, 'COMPILE_ERROR');
  assert.equal(result.score, 0);
  assert.equal(result.failedCount, 2);
});

test('[TEST] Internal Error: expose no valid score and do not penalize the submission', async () => {
  const jobs = memoryStore();
  const judgments = memoryStore();
  const submissions = memoryStore([submission]);
  const queue = createGradingQueue({
    readJobs: jobs.read,
    mutateJobs: jobs.mutate,
    readJudgments: judgments.read,
    mutateJudgments: judgments.mutate,
    readSubmissions: submissions.read,
    mutateSubmissions: submissions.mutate,
    loadAssignmentVersion: async () => version([
      { id: 'test-1', input: 'a', expectedOutput: 'a', weight: 1 },
    ]),
    evaluator: async () => {
      throw new GradingInfrastructureError('worker unavailable');
    },
    concurrency: 0,
    maxAttempts: 1,
  });

  const job = await queue.enqueue(submission.id);
  await queue.process(job.id);

  assert.equal(judgments.value()[0].status, 'INTERNAL_ERROR');
  assert.equal(judgments.value()[0].score, null);
  assert.equal(submissions.value()[0].status, 'INTERNAL_ERROR');
});

test('[TEST] Retry: retry infrastructure failure without retrying student failures', async () => {
  const jobs = memoryStore();
  const judgments = memoryStore();
  const submissions = memoryStore([submission]);
  let evaluations = 0;
  const queue = createGradingQueue({
    readJobs: jobs.read,
    mutateJobs: jobs.mutate,
    readJudgments: judgments.read,
    mutateJudgments: judgments.mutate,
    readSubmissions: submissions.read,
    mutateSubmissions: submissions.mutate,
    loadAssignmentVersion: async () => version([
      { id: 'test-1', input: 'a', expectedOutput: 'a', weight: 1 },
    ]),
    evaluator: async (input) => {
      evaluations += 1;
      if (evaluations === 1) throw new GradingInfrastructureError('temporary worker outage');
      return evaluateSubmission({
        ...input,
        imageId,
        runner: async () => batch([success('wrong')]),
      });
    },
    concurrency: 0,
    maxAttempts: 2,
  });

  const job = await queue.enqueue(submission.id);
  await queue.process(job.id);
  assert.equal(judgments.value()[0].status, 'INTERNAL_ERROR');
  assert.equal(judgments.value()[0].score, null);

  await queue.process(job.id);
  assert.equal(judgments.value()[1].status, 'COMPLETED');
  assert.equal(judgments.value()[1].score, 0);
  assert.equal(judgments.value()[1].verdict, 'WRONG_ANSWER');
  assert.equal(jobs.value()[0].attempts, 2);
});

test('[TEST] Hidden test security: student sees aggregate only; lecturer can inspect details', async () => {
  const graded = await evaluateSubmission({
    submission,
    assignmentVersion: version([
      { id: 'public', input: 'public-input', expectedOutput: 'public-output', weight: 1 },
      {
        id: 'hidden',
        input: 'HIDDEN_INPUT_SECRET',
        expectedOutput: 'HIDDEN_EXPECTED_SECRET',
        hidden: true,
        weight: 2,
      },
    ]),
    judgmentId: 'judgment-hidden-security',
    imageId,
    runner: async ({ tests }) => batch(tests.map(({ input }) =>
      success(input === 'public-input' ? 'public-output' : 'HIDDEN_ACTUAL_SECRET'))),
  });
  const judgment = {
    id: 'judgment-hidden-security',
    submissionId: submission.id,
    assignmentVersionId: submission.assignmentVersionId,
    attempt: 1,
    status: 'COMPLETED',
    createdAt: '2026-11-12T00:00:00.000Z',
    startedAt: '2026-11-12T00:00:00.000Z',
    completedAt: '2026-11-12T00:00:01.000Z',
    ...graded,
  };
  const studentPayload = JSON.stringify(studentJudgmentView(judgment));
  const lecturerPayload = JSON.stringify(lecturerJudgmentView(judgment));

  assert.match(studentPayload, /public-input/);
  assert.deepEqual(studentJudgmentView(judgment).hiddenTests, {
    passedCount: 0,
    totalCount: 1,
    earnedWeight: 0,
    maxWeight: 2,
  });
  for (const secret of ['HIDDEN_INPUT_SECRET', 'HIDDEN_EXPECTED_SECRET', 'HIDDEN_ACTUAL_SECRET']) {
    assert.equal(studentPayload.includes(secret), false, `Student payload leaked ${secret}`);
    assert.equal(lecturerPayload.includes(secret), true);
  }
});
