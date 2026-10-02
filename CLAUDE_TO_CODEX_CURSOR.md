# Claude -> Codex/Cursor Handoff

## One-time handoff prompt

Copy the prompt below into Codex or Cursor Agent mode after opening the NutraFuel repository.

```text
You are taking over development of an existing NutraFuel / NutriFit Recipe Nutrition Engine repository that was previously developed with Claude.

Do not assume the old Claude conversation is available. The repository is the source of truth.

FIRST: READ, DO NOT MODIFY
1. Read README.md.
2. Read AGENTS.md.
3. Read PROJECT_STATUS.md.
4. Read TODO.md.
5. Inspect the complete repository tree.
6. Inspect git status, recent commits, and the current diff.
7. Run the existing tests with pytest -q.
8. Start the FastAPI app and verify the health endpoint.
9. Inspect the parse/analyze API paths.
10. Audit whether the frontend/static UI is actually present and integrated.

Then produce a concise baseline report containing:
- architecture you found
- tests and exact test result
- API health result
- parser behavior you verified
- analyzer behavior you verified
- frontend/UI status
- current failures or suspicious behavior
- the smallest safe next step

IMPORTANT PROJECT RULES
- Do not rewrite working architecture without evidence.
- Do not silently guess ambiguous ingredients.
- Generic 'oil' must not become sunflower oil or another named oil without explicit user information.
- Serving metadata is recipe-level metadata, never an ingredient.
- Dish headers such as 'Chicken curry:' are dish metadata, never an ingredient.
- Cooking instructions must not become fake ingredients.
- Water loss changes mass, not calories/macros.
- Do not double-count user-itemized oil.
- Nutrition numbers come from reference data and deterministic arithmetic, not model guesses.
- Every bug fix should have a regression test.
- Preserve API contracts unless a deliberate, tested change is required.

WORKFLOW AFTER THE BASELINE
1. Fix P0 issues first.
2. Make one focused change at a time.
3. Run relevant tests after each change.
4. Run the full pytest suite before declaring a task complete.
5. For API/UI changes, test the real HTTP/browser path as well as unit tests.
6. Review git diff for unintended changes.
7. Summarize exactly what changed and what was tested.

DO NOT start adding new features until the existing application has a verified baseline.

When I give you a bug, follow this loop:
REPRODUCE -> LOCATE ROOT CAUSE -> ADD/UPDATE REGRESSION TEST -> FIX -> RUN TESTS -> VERIFY API/UI -> REVIEW DIFF -> REPORT.
```

## Normal daily prompt

After the baseline is established, use short task prompts such as:

```text
Inspect the current NutraFuel state first. Reproduce the issue, identify the root cause, add a regression test, make the smallest correct fix, run pytest -q, and verify the affected API/UI path. Do not modify unrelated files.
```

## Continuous QA prompt

Use this when you want the agent to work through the backlog:

```text
Work through NutraFuel TODO.md from the highest-priority unfinished item.

For each issue:
1. reproduce it;
2. identify the root cause;
3. add a regression test;
4. implement the smallest correct fix;
5. run the affected tests;
6. run the complete pytest -q suite;
7. verify the API and UI when applicable;
8. inspect the diff;
9. update TODO.md or PROJECT_STATUS.md when the status genuinely changes.

Do not make speculative rewrites. Stop and report if a requirement is ambiguous or if a change could break an existing API contract.
```

## Important note about local work

The GitHub repository does not prove that every local UI file or uncommitted parser change has been pushed. Before pulling, rebasing, or deleting anything locally, inspect `git status` and preserve user changes.
