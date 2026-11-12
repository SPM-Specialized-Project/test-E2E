# US-008.2 Auto Grading & Test Feedback

Acceptance tests for grading outcomes, partial credit, retry behavior, and
student/lecturer visibility of hidden-test data.

## Run

From the repository root:

```powershell
node --test backend/test/us-008.2/us-008.2.spec.ts
```

The `.spec.ts` file uses Node's built-in test runner and currently requires
Node.js 22.6 or newer for built-in TypeScript type stripping. The command above
was verified with Node.js 24.16.0.

## Covered scenarios

| Scenario | Expected behavior |
| --- | --- |
| Accepted | All tests pass and the earned score is 100%. |
| Wrong Answer | A 3/5 result earns 60%; failing all tests earns a valid 0 score; public feedback includes input, expected output, actual output, and verdict. |
| Compile Error | Test execution stops and the result is a valid 0 score. |
| Internal Error | No valid score is recorded (`score: null`); the submission reports `INTERNAL_ERROR`. |
| Retry | Infrastructure failures can be retried; the next attempt records its own result. |
| Hidden-test security | Student judgment data contains only the hidden aggregate, while lecturer judgment data retains the full diagnostics. |

## Scope and limitations

These tests exercise the grading evaluator, queue behavior, and judgment DTOs.
They do not replace HTTP-level authorization and network-payload tests, frontend
rendering tests, or sandbox integration tests; run the corresponding backend
and frontend suites for those checks.
