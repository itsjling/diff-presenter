$autoresearch
Goal: Confirm each proposed Diffsplain speed change with repeatable timing tests; keep gains and reject non-gains.
Scope: scripts/*.mjs, app/page.tsx, tests/*.test.mjs, benchmarks/*.mjs
Metric: Median wall time for the stage each change targets
Direction: lower_is_better
Verify: node benchmarks/pipeline-speed.mjs --case all --fixture working --runs 5
Guard: npm run lint && npm test
Iterations: 8

Acceptance:
- At least 5% lower median time on the working fixture.
- All affected tests pass.
- No more than 3% slower on the held-out fixture.
- Results that change model quality or output shape need a separate quality check.

Terminal choice: stop-at-verified. Do not push, publish, or deploy.
