# WebUI cleanup — shared components, not a redesign

Notes from a quick audit of the console UI, prompted by a "does the UI need a rethink"
question, then widened to "make every page consistent and standard." Not a phase, not
scheduled — a starting point if/when this gets picked up.

## 1. What's there today

`plugins/webui` is a thin shell (`app/shell/root.vue`): nav, router, connection state. It
contributes no page content. Every media kind plugin owns its own pages under
`plugins/<kind>/client/`:

| Plugin   | Files                                                     | Lines |
| -------- | ---------------------------------------------------------- | ----- |
| movies   | `add-movie.vue`, `movie-detail.vue`, `movie-list.vue`       | 531   |
| series   | `add-series.vue`, `series-detail.vue`, `series-list.vue`    | 539   |
| music    | `add-artist.vue`, `album-detail.vue`, `artist-detail.vue`, `artist-list.vue` | 647 |
| podcasts | `add-podcast.vue`, `podcast-detail.vue`, `podcast-list.vue` | 531   |
| books    | `add-author.vue`, `author-detail.vue`, `author-list.vue`    | 549   |

~2,800 lines total. The only shared *component* is `packages/console-kit`
(`ReleasePicker.vue` + status helpers) — nothing for the list/detail/add pattern itself.

Everything else in the console — auth, calendar, decision (profiles/formats/parse-tester),
downloads, history, indexers, library, metadata, settings, system — is one page each,
50–320 lines, not a repeated kind × page matrix.

## 2. What's already standard — leave it alone

Before adding components, worth naming what's *not* broken, so the cleanup doesn't turn
into a rewrite:

- **The CSS system.** `plugins/webui/app/shell/style.css` (633 lines) already defines a
  full vocabulary every page draws on: `.mp-head`, `.mp-card`, `.mp-grid`/`.tile`/`.poster`,
  `.mp-hero`, `.mp-section` (collapsible `<details>`), `.mp-table`, `.mp-badge`,
  `.mp-tabs`, `.mp-field`, `.mp-search`, `.mp-result`, buttons (`.primary`/`.danger`/
  `.small`/`.link`), `.mp-empty`/`.mp-error`. Every page below already uses these classes
  consistently — the visual language is not the problem.
- **Provider settings.** `indexers.vue` and `downloads/clients.vue` are ~45 lines each: they
  compute a status map and a `test()` function, then hand both to a shared
  `<k-slot name="provider-settings">` (backed by `plugins/settings/client/provider-settings.vue`,
  schema-driven). This is exactly the pattern the media pages should follow — a thin
  per-domain wiring file over one shared implementation.
- **Status badges.** Each media plugin's `status.ts` (e.g. `movies/client/status.ts`,
  `series/client/status.ts`) computes `{ text, class }` for its own domain, but all of them
  build on shared `console-kit` helpers (`downloadStatus`, `DOWNLOAD_LABELS`, `fileSize`).
  The logic differs because the domains genuinely differ (an album's "missing" isn't a
  movie's) — this is not duplication to remove, it's business logic that happens to render
  through the same `.mp-badge` class.
- **Precedent for extraction already exists.** `history/client/history-table.vue` is a real
  shared component: `history.vue`, `movie-history.vue` and `series-history.vue` (16-17
  lines each) all just fetch data and render `<history-table>`. That's the shape every
  media-kind page should end up in.

## 3. The duplication

Each kind's three pages follow the same shape:

- **List** — a card grid of the kind's items, click through to detail.
- **Add** — search an external source (TMDB, iTunes, etc.), pick a result, set
  kind-specific options (quality profile, monitor mode, folders…), submit.
- **Detail** — metadata header, kind-specific config, related items/history, actions.

Diffing `add-movie.vue` against `add-series.vue` (fields aside) shows identical structure:
same `mp-head` / `mp-lead` / `mp-empty` classes, same search-debounce → pick → configure →
submit flow, same button states (`{{ adding ? 'Adding…' : 'Add' }}`). The five plugins each
reimplement this rather than sharing it, so each one has drifted slightly (different
loading-state wording, different empty-state markup, different card layouts) even though
nothing about the *design* actually differs on purpose.

This is the real problem, not visual polish: five copies of the same flow that will keep
diverging every time one of them is touched.

## 4. Proposed components (`console-kit`)

Parameterized by data/fields; each kind plugin supplies configuration and slots, not
markup. In rough size order, largest payoff first:

| Component            | Replaces                                                        | Notes |
| --------------------- | ----------------------------------------------------------------| ----- |
| `MediaCardGrid`       | all 5 `*-list.vue` grids                                        | items, `href`, poster/placeholder, a `statusFn`; filter input and empty state built in; summary line and one extra slot (movies' setup checklist, series' "add a root folder" card) stay as page-level content above the grid. |
| `MediaDetailShell`    | the `.mp-hero` header in all 5 `*-detail.vue`                   | poster, title, year/facts, status, overview, action buttons as a slot. |
| `CollapsibleSection`  | every hand-rolled `.mp-section` (`<details>`) block              | episodes (series), tracks (music), formats (books), releases — same open/close chevron markup repeated per section, per plugin. |
| `AddMediaFlow`        | all 5 `add-*.vue` search→pick→configure→submit flows              | search box + debounce, result list (`.mp-result`), a slot for the kind-specific configure fields, submit button with `{{ busy ? '…' : 'Add' }}` state. Most per-kind variance lives here (monitor modes, season folders, quality profile) — do this one last. |
| `TabBar`              | inline `.mp-tabs` button loops (`decision/profiles.vue`, family picker) | 2 current uses; only worth it if a 3rd shows up — listed for completeness, not urgent. |

`ReleasePicker` and the `status.ts` helpers stay as-is (see §2) — they're not part of this.

## 5. Order of work

1. `MediaCardGrid` — 5 near-identical call sites already, smallest risk.
2. `history-table.vue`-style extraction is proof this works; use it as the template for
   `MediaDetailShell` and `CollapsibleSection` next — both are structural, no business logic.
3. `AddMediaFlow` last — most per-kind variance, needs the slot API to have settled first.
4. `TabBar` opportunistically, only when a third consumer shows up.

Each step should leave one plugin (movies is the oldest/most-used) as the reference
migration before touching the rest, same as any shared-component extraction.

## 6. Tradeoff

Extracting shared components costs real short-term work: touching every plugin that owns a
list/detail/add page, finding the actual variance points vs. accidental drift, and getting
the slot/prop API right so the next media kind doesn't need a sixth copy. The alternative —
a CSS/visual pass over the existing copies — is faster and lower-risk, but doesn't stop the
duplication from growing; it just makes today's copies look more alike until the next edit.
Going further than §4 (e.g. forcing settings/system/calendar pages, which are already
one-off and small, into shared components they don't need) would be over-engineering —
consistency here means "stop copy-pasting the repeated kind × page matrix," not "every page
must use the same component."

## 7. Status

Not started. No milestones yet — this is scoping, not a commitment.
