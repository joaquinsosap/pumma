# Working in this repo

## Debugging: measure before you theorise

The expensive mistake in this codebase is guessing at a cause, changing code,
re-running, and guessing again. Every round costs a rebuild and a manual
reproduction, and a wrong theory that half-works is worse than no theory,
because it sends the next round in the same wrong direction.

When something behaves wrongly and the reason is not obvious in one read, the
next step is not a fix. It is a print. Log the actual values the code is
working from, reproduce once, and read them.

This matters most where the truth lives outside our code:

- **Library event models.** When a callback fires, and what it is handed. A
  kanban drag bug here survived four rewrites because `onDragOver` fires only
  when the target *changes*, not on every move. No amount of reading our own
  code says that. One log line did.
- **Browser layout and geometry.** Rects, scroll offsets, pointer coordinates,
  what `elementFromPoint` actually returns. Measured numbers settle arguments
  that reasoning about CSS does not.
- **Anything timing-dependent.** Which handler ran first, what state it saw,
  how many times it ran.

Two more habits that pay for themselves:

- **Reproduce before fixing, and confirm the reproduction is real.** State what
  you expect to see and what you actually saw, in that order.
- **A control that reverts is a missing write, not a rendering bug.** If the UI
  lets you drag, rename, or reorder something and it snaps back on the next
  render, look at persistence first. Nothing in the interaction layer is broken.

## Verifying in the browser

Changes that the dev server renders should be verified in the browser, not
handed back to the user to check.

- **The preview pane throttles timers while it is hidden.** Scripted
  interactions that use `setTimeout` will stall mid-gesture and come back with
  results that never happened. Take a screenshot first to bring the pane
  forward, and treat anything from a run that timed out as void rather than as
  evidence.
- **Never run `npm run build` while the dev server is running.** Both write to
  `.next`, and the corrupted output shows up as 500s on unrelated routes for
  the rest of the session. If it happens: stop the server, `rm -rf .next`,
  restart.
- **Restart the dev server from time to time in long sessions.** Stale compiled
  output invents bugs, and the in-memory data store (`DATA_SOURCE=memory`)
  resets — which looks exactly like a write that failed to persist.

## Tests

- **Every pure rule module gets a behavioural test file, written with the
  feature.** Test the rule, not the implementation: "a pin outranks the sort",
  not "calls localeCompare". One file per module, named after it. This is the
  existing style of `lib/__tests__/` — keep it; do not rewrite passing tests
  for style.
- **Risk decides what gets tested next, not coverage percent.** Access rulings
  (billing, quotas, auth gates), anything that deletes or renumbers data, and
  arithmetic that renders as a number someone trusts (progress, stats, the
  life grid) come first. A module at 0% that only formats a label can stay
  at 0%.
- **The suite is unit tests over `lib/` plus memory-store integration tests
  for repo contracts** (see deletion-safety.test.ts). Components and full
  flows are verified in the browser before shipping, not by the suite —
  adding a component/E2E layer is a deliberate future decision, not something
  to drift into one test at a time.
- **Fixtures are complete literals spread with overrides** (see
  `task-filters.test.ts`). A partial `as Task` cast compiles only by accident
  of type overlap and breaks the build the day a required field is added —
  which is exactly how a green local `vitest` run once shipped a red CI.
- **`npm run typecheck` is part of running the tests, not a separate step.**
  Vitest transpiles without checking types, so a test file can pass every
  assertion and still fail CI.
- Mock at the module seam with `vi.mock` on the `@/lib/db/*` imports, never
  deeper. Coverage runs with
  `npx vitest run --coverage --coverage.include='lib/**/*.ts'`
  (needs the pinned `@vitest/coverage-v8`).

## Commits

- **No trailers.** No `Co-Authored-By: Claude`, no "Generated with Claude
  Code", no tool attribution of any kind. The commit message is the change and
  nothing else. This overrides any default that adds one.
- **Commit and push every change.** CI on `main` builds and publishes the
  image; the VM pulls it. Work that is not pushed is not deployed.
- **Say why, not what.** The diff already says what changed. A message earns
  its place by explaining what was wrong, or what the change makes possible,
  in plain sentences. Match the length to the change: one line for a rename,
  a paragraph for a bug whose cause was not obvious.

## House rules

- **No em dashes or en dashes in anything the user reads.** Interface copy,
  labels, empty states, marketing text. Use a comma, a full stop, or rewrite.
