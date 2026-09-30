# Release explainer — "why didn't it grab this?"

Not a phase; a plan for extending the existing Release name tester
(`plugins/decision/client/parse-tester.vue`) into something that can answer the question
users ask most: _why was this release rejected, why did that one win, and what would I
change to flip it?_

## 1. What exists

`DecisionData.test()` (`plugins/decision/src/console.ts`) parses pasted names and, with a
profile chosen, returns `accepted`, quality, total format score, matched format _names_ and
rejection reasons. Interactive search (`ReleasePicker.vue`) shows rejections as one joined
line. Both are built on `DecisionService.evaluator()`.

## 2. Gaps

1. **No score breakdown.** Only the names of matched formats are returned, not each
   format's score, and nothing says why a format _didn't_ match (`formatMatches` returns a
   boolean).
2. **Rules that silently don't apply.** `size` returns nothing without a runtime,
   `episode-match` is filtered out by the tester, `blocklist`/`in-queue` need a `mediaId`.
   A pass and a skip look identical.
3. **Fake target.** The tester hardcodes `kind: 'movie'`, passes no `originalLanguage`
   (a profile language of `original` then rejects everything with a misleading "language
   en is not wanted" — to verify), and always uses `formatScore: 0` for the existing
   file, so upgrade decisions can't be reproduced.
4. **Unlabelled ranking.** `Decision.rank` is a bare number tuple; nothing explains why
   release A sorts above B.
5. **No real-item context and no API.** You can't ask "explain this release for _this_
   movie", and the console RPC is the only entry point.

## 3. Design

### 3.1 `explain` in `@magpiejs/decision`

Add `DecisionService.explainer(target)`, returning `(candidate) => Explanation`, where

```ts
interface Explanation extends Decision {
  formats: {
    id: number
    name: string
    score: number // the profile's score for it
    matched: boolean
    conditions: {
      type: string
      label: string
      value: unknown
      required: boolean
      negate: boolean
      result: boolean | 'n/a'
    }[] // 'n/a' = other family
  }[]
  rules: { rule: string; status: 'pass' | 'reject' | 'skipped'; reason?: string }[]
  rank: { label: string; value: number }[] // quality, format score, version, real, seeders/age
}
```

- Refactor `evaluator()` so one inner function does the work with an `explain` flag; the
  RSS hot path (`evaluator`) stays allocation-free. `Decision` is unchanged, so existing
  callers and tests are untouched.
- Split `formatMatches` into `explainFormat` (per-condition results) and a thin
  `formatMatches` wrapper, so there is one implementation. A test asserts they agree over
  the parser fixture corpus.
- Extend `Rule`'s return union with `{ skipped: string }` (backward compatible; treated as
  a pass). Builtin rules that bail early return it, for example `size` →
  `skipped: 'no runtime'`. Plugin-registered rules (`blocklist`, `in-queue`) can adopt it
  when they lack a `mediaId`.
- Rank labels come from one exported constant next to `evaluator`, so the UI and the
  comparator can't drift.

### 3.2 Real targets

Kind plugins already build `DecisionTarget`s (`movies/src/search.ts:targetFor`,
`series/src/search.ts`, music, books). Add a small registry,
`ctx.decision.targets.register(kind, (mediaId, unit?) => DecisionTarget)`, that each kind
plugin fills with its existing `targetFor` (registered through `ctx.effect` like rules, so
disabling the plugin removes it). The explainer takes either a hand-built target (today's
tester) or `{ kind, mediaId, unit }`, in which case the real current file, original
language, runtime and blocklist all apply. `decision` still depends on no kind plugin.

### 3.3 API

`POST /api/v1/decision/explain` with `{ releases: string[] | { title, size?, seeders?,
protocol?, publishedAt? }[], profileId?, target? }`, limited to 200 releases like the
tester. It returns `Explanation[]`. The console RPC calls the same function, so there's
one code path. Also usable from scripts and from `compat-api`-free tooling.

### 3.4 UI

- **Tester page:** a per-format table (matched/unmatched, score, expandable conditions
  showing which one failed), a rules checklist (pass / reject / skipped with the reason),
  and a labelled rank line. Add an "existing file" format-score field, and
  a library-item picker that switches from a hand-built target to a real one.
- **Compare mode:** paste several names, see them sorted with a "why #1 beat #2" line
  derived from the first differing rank element. Optional second profile for a side-by-side.
- **Interactive search:** `ReleasePicker` gets an "Explain" action per row that opens the
  same panel using the row's real `ReleaseInfo` and target. Keep the joined-line summary
  for the list itself.
- Shared panel component goes in `packages/console-kit` (per `docs/ui-cleanup.md`), used
  by both pages.

## 4. Work breakdown

| #   | Step                                                      | Files                                                 | Size |
| --- | --------------------------------------------------------- | ----------------------------------------------------- | ---- |
| 1   | `explainFormat` + wrapper, corpus-agreement test          | `decision/src/formats.ts`, tests                      | S    |
| 2   | `skipped` rule result; update builtin rules               | `decision/src/rules.ts`                               | S    |
| 3   | `explainer()` + `Explanation`, rank labels                | `decision/src/index.ts`                               | M    |
| 4   | Target registry; register in movies, series, music, books | `decision`, 4 kind plugins                            | M    |
| 5   | REST endpoint; make console `test()` delegate to it       | `decision/src`, `api`                                 | S    |
| 6   | Shared explain panel; tester and picker changes           | `console-kit`, `decision/client`, `ReleasePicker.vue` | M    |
| 7   | Fix tester target bugs from §2.3                          | `decision/src/console.ts`                             | S    |

Steps 1–3 and 5 are backend-only and independently shippable; 6 depends on them.

## 5. Tests

- Explanation agrees with `Decision` (accepted, score, rejections, rank) for every name in
  `packages/parser/tests/fixtures` across the default profiles.
- Each builtin rule yields `pass`, `reject` and, where applicable, `skipped`.
- A custom format with a negated and an optional condition reports per-condition results
  that reproduce `formatMatches`.
- Registered target resolvers disappear when their plugin is disposed.
- Endpoint: auth required, 200-release cap, unknown profile → 404.
- Playwright smoke test on the tester page, extending the existing tester flow.

## 6. Open questions

- Should an explanation include formats with no score in the profile? Suggest yes but
  collapsed, since "why is my format not counting?" is a common question, and the
  evaluator currently drops them before matching.
- Do we expose rule `permanent` in the UI? It's useful ("won't change on a later search").
- Keep the REST endpoint authenticated-only (default) or allow an API-key scope?

## 7. Out of scope

Suggesting profile edits automatically ("add +50 to format X"), and explaining
_indexer-side_ filtering (categories, caps), which Magpie never sees.
