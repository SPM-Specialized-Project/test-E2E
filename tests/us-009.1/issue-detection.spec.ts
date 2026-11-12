import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { APPROVED_PROBLEM_TYPES, createIssueDetectionService } from '../../backend/issue-detection.mjs';

const sourceCode = 'function recurse() {\n  return recurse();\n}';
const temporaryDirectories: string[] = [];

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'us0091-issue-detection-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'issue-detection.json');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function makeInput(
  snapshotId: string,
  options: {
    eventId?: string;
    eventSequence?: number;
    milestone?: 'SAVE' | 'RUN' | 'SUBMIT';
    executionStatus?: string;
  } = {},
) {
  const execution = options.milestone === 'SAVE' ? null : {
    id: `execution-${snapshotId}`,
    state: 'FINISHED',
    status: options.executionStatus ?? 'COMPLETED_WITH_FAILURES',
    results: [{ testCaseId: 'case-1', status: 'WRONG_ANSWER', passed: false }],
  };
  return {
    workspace: {
      id: 'workspace-1',
      classroomId: 'class-1',
      assignmentId: 'problem-1',
      ownerEmail: 'student@example.test',
    },
    snapshot: { id: snapshotId, hash: `hash-${snapshotId}`, revision: 1 },
    assignmentVersion: {
      id: 'problem-1-v7',
      assignmentId: 'problem-1',
      version: 7,
      title: 'Recursive list traversal',
      description: 'Traverse a linked list recursively.',
      constraints: 'The list may be empty.',
    },
    milestone: options.milestone ?? 'RUN',
    executionId: execution?.id ?? null,
    execution,
    eventId: options.eventId,
    eventSequence: options.eventSequence,
  };
}

function makeService(file: string, evaluate: (input: any) => Promise<any> | any, overrides: Record<string, unknown> = {}) {
  return createIssueDetectionService({
    file,
    evaluate,
    resolveSnapshot: async (id: string) => ({
      id,
      sourceCode,
      hash: `hash-${id}`,
      revision: 1,
    }),
    ...overrides,
  });
}

async function waitForAssessments(service: any, count: number) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const assessments = await service.listAssessments('class-1');
    if (assessments.length === count
      && assessments.every((item: any) => ['EVALUATED', 'INSUFFICIENT_EVIDENCE', 'FAILED'].includes(item.state))) {
      return assessments;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Assessments did not reach a terminal state: ${JSON.stringify(await service.listAssessments('class-1'))}`);
}

async function waitForGap(service: any, assessmentId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const assessment = (await service.listAssessments('class-1')).find((item: any) => item.id === assessmentId);
    if (assessment?.resultCode === 'EVENT_SEQUENCE_GAP') return assessment;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Assessment did not record the missing event sequence.');
}

function verifiedFinding(input: any) {
  return {
    findings: [{
      problemTypeId: 'BOUNDARY_FAILURE',
      rationale: 'The recursive function has no base case for an empty list.',
      evidence: [
        {
          kind: 'CODE',
          snapshotId: input.snapshot.id,
          lineStart: 1,
          lineEnd: 3,
          excerpt: sourceCode,
        },
        {
          kind: 'TEST',
          executionId: input.executionContextId,
          testCaseId: 'case-1',
          status: 'WRONG_ANSWER',
        },
      ],
    }],
  };
}

describe('US-009.1 asynchronous issue detection', () => {
  it('dispatches evaluation without waiting for the evaluator and keeps the pinned version and milestone', async () => {
    const file = await createStore();
    let releaseEvaluation!: () => void;
    let evaluationStarted!: () => void;
    let evaluatedInput: any;
    const started = new Promise<void>((resolve) => { evaluationStarted = resolve; });
    const evaluatorGate = new Promise<void>((resolve) => { releaseEvaluation = resolve; });
    const service = makeService(file, async (input: any) => {
      evaluatedInput = input;
      evaluationStarted();
      await evaluatorGate;
      return { findings: [] };
    });

    const queued = await service.trigger(makeInput('snapshot-save', { eventId: 'save-event', milestone: 'SAVE' }));
    await started;

    assert.equal(queued.state, 'PENDING');
    assert.equal(queued.milestone, 'SAVE');
    assert.equal(queued.assignmentVersionId, 'problem-1-v7');
    assert.deepEqual(queued.inputCoverage, { snapshot: true, problemVersion: true, executionContext: false });
    assert.equal((await service.listAssessments('class-1'))[0].state, 'EVALUATING');

    releaseEvaluation();
    assert.equal((await waitForAssessments(service, 1))[0].state, 'INSUFFICIENT_EVIDENCE');
    assert.equal(evaluatedInput.problem.versionId, 'problem-1-v7');
    assert.equal(evaluatedInput.snapshot.id, 'snapshot-save');
  });

  it('SCRUM-191: evaluates workspace events in sequence despite out-of-order arrival', async () => {
    const evaluationOrder: number[] = [];
    const service = makeService(await createStore(), async (input: any) => {
      evaluationOrder.push(input.eventSequence);
      return { findings: [] };
    });

    await service.trigger(makeInput('snapshot-3', { eventId: 'event-3', eventSequence: 3, milestone: 'SUBMIT' }));
    const held = await waitForGap(service, (await service.listAssessments('class-1'))[0].id);
    assert.equal(held.missingEventSequence, 1);
    assert.deepEqual(evaluationOrder, []);

    await service.trigger(makeInput('snapshot-1', { eventId: 'event-1', eventSequence: 1, milestone: 'SAVE' }));
    await service.trigger(makeInput('snapshot-2', { eventId: 'event-2', eventSequence: 2, milestone: 'RUN' }));
    await waitForAssessments(service, 3);

    assert.deepEqual(evaluationOrder, [1, 2, 3]);
    assert.deepEqual((await service.listAssessments('class-1')).map((item: any) => item.milestone).sort(), ['RUN', 'SAVE', 'SUBMIT']);
  });

  it('SCRUM-192: deduplicates a retried event and appends later evidence to one active case', async () => {
    const service = makeService(await createStore(), async (input: any) => verifiedFinding(input));
    const firstInput = makeInput('snapshot-1', { eventId: 'same-logical-event', eventSequence: 1 });
    const first = await service.trigger(firstInput);
    const retry = await service.trigger(firstInput);
    const second = await service.trigger(makeInput('snapshot-2', { eventId: 'next-event', eventSequence: 2 }));
    await waitForAssessments(service, 2);

    const cases = await service.listIssueCases('class-1');
    assert.equal(retry.id, first.id);
    assert.notEqual(second.id, first.id);
    assert.equal(cases.length, 1);
    assert.equal(cases[0].status, 'ACTIVE');
    assert.equal(cases[0].episodeNumber, 1);
    assert.equal(cases[0].evidence.length, 2);
    assert.deepEqual(cases[0].evidence.map((item: any) => item.snapshotId).sort(), ['snapshot-1', 'snapshot-2']);
    assert.match(cases[0].evidence[0].rationale, /no base case/);
    assert.deepEqual(cases[0].relatedTestCaseIds, ['case-1']);
  });

  it('SCRUM-193: holds a sequence gap and resumes evaluation when the missing event arrives', async () => {
    const evaluationOrder: number[] = [];
    const service = makeService(await createStore(), async (input: any) => {
      evaluationOrder.push(input.eventSequence);
      return { findings: [] };
    });

    const later = await service.trigger(makeInput('snapshot-2', { eventId: 'event-2', eventSequence: 2 }));
    const held = await waitForGap(service, later.id);
    assert.equal(held.state, 'PENDING');
    assert.equal(held.missingEventSequence, 1);
    assert.deepEqual(evaluationOrder, []);

    await service.trigger(makeInput('snapshot-1', { eventId: 'event-1', eventSequence: 1 }));
    const assessments = await waitForAssessments(service, 2);
    assert.deepEqual(evaluationOrder, [1, 2]);
    assert.equal(assessments.every((item: any) => item.state === 'INSUFFICIENT_EVIDENCE'), true);
  });

  it('SCRUM-194: recovers an evaluating assessment after service restart', async () => {
    const file = await createStore();
    const timestamp = new Date().toISOString();
    await writeFile(file, `${JSON.stringify({
      assessments: [{
        id: 'assessment-reconnect',
        eventId: 'event-reconnect',
        eventSequence: 1,
        classroomId: 'class-1',
        workspaceId: 'workspace-1',
        studentEmail: 'student@example.test',
        assignmentId: 'problem-1',
        assignmentVersionId: 'problem-1-v7',
        snapshotId: 'snapshot-reconnect',
        executionId: null,
        submissionId: null,
        milestone: 'SAVE',
        state: 'EVALUATING',
        inputCoverage: { snapshot: true, problemVersion: true, executionContext: false },
        createdAt: timestamp,
        updatedAt: timestamp,
        analysisInput: {
          eventId: 'event-reconnect',
          eventSequence: 1,
          milestone: 'SAVE',
          problem: { id: 'problem-1', versionId: 'problem-1-v7' },
          problemTypes: APPROVED_PROBLEM_TYPES,
        },
      }],
      issueCases: [],
      caseEvidence: [],
      problemTypes: APPROVED_PROBLEM_TYPES,
      caseTests: [],
    }, null, 2)}\n`, 'utf8');

    let evaluationCount = 0;
    const service = makeService(file, async () => {
      evaluationCount += 1;
      return { findings: [] };
    });
    await service.initialize();
    const [assessment] = await waitForAssessments(service, 1);

    assert.equal(assessment.state, 'INSUFFICIENT_EVIDENCE');
    assert.equal(evaluationCount, 1);
  });

  it('does not create cases from infrastructure errors, provider failures, or unverifiable findings', async () => {
    let evaluationCount = 0;
    const service = makeService(await createStore(), async (input: any) => {
      evaluationCount += 1;
      if (input.snapshot.id === 'snapshot-provider-error') {
        throw Object.assign(new Error('Provider unavailable.'), { code: 'AI_PROVIDER_UNAVAILABLE' });
      }
      return {
        findings: [{
          problemTypeId: input.snapshot.id === 'snapshot-unapproved' ? 'UNAPPROVED_TYPE' : 'BOUNDARY_FAILURE',
          rationale: 'This claimed code excerpt is not present in the pinned snapshot.',
          evidence: [{
            kind: 'CODE',
            snapshotId: input.snapshot.id,
            lineStart: 1,
            lineEnd: 1,
            excerpt: 'invented source code',
          }],
        }],
      };
    });

    await service.trigger(makeInput('snapshot-runner-error', { eventSequence: 1, executionStatus: 'INTERNAL_ERROR' }));
    await service.trigger(makeInput('snapshot-provider-error', { eventSequence: 2 }));
    await service.trigger(makeInput('snapshot-unapproved', { eventSequence: 3 }));
    await service.trigger(makeInput('snapshot-network-error', { eventSequence: 4, executionStatus: 'NETWORK_ERROR' }));
    const assessments = await waitForAssessments(service, 4);
    const bySnapshot = new Map(assessments.map((item: any) => [item.snapshotId, item]));

    assert.deepEqual(
      { state: bySnapshot.get('snapshot-runner-error')?.state, resultCode: bySnapshot.get('snapshot-runner-error')?.resultCode },
      { state: 'INSUFFICIENT_EVIDENCE', resultCode: 'RUNNER_INFRASTRUCTURE_ERROR' },
    );
    assert.deepEqual(
      { state: bySnapshot.get('snapshot-provider-error')?.state, resultCode: bySnapshot.get('snapshot-provider-error')?.resultCode },
      { state: 'FAILED', resultCode: 'AI_PROVIDER_UNAVAILABLE' },
    );
    assert.deepEqual(
      { state: bySnapshot.get('snapshot-unapproved')?.state, resultCode: bySnapshot.get('snapshot-unapproved')?.resultCode },
      { state: 'INSUFFICIENT_EVIDENCE', resultCode: 'NO_VERIFIABLE_TAXONOMY_MATCH' },
    );
    assert.deepEqual(
      { state: bySnapshot.get('snapshot-network-error')?.state, resultCode: bySnapshot.get('snapshot-network-error')?.resultCode },
      { state: 'INSUFFICIENT_EVIDENCE', resultCode: 'RUNNER_INFRASTRUCTURE_ERROR' },
    );
    assert.equal(evaluationCount, 2);
    assert.deepEqual(await service.listIssueCases('class-1'), []);
  });
});
