# WebUI cleanup — shared components, not a redesign

Notes from a quick audit of the console UI, prompted by a "does the UI need a rethink"
question. Not a phase, not scheduled — a starting point if/when this gets picked up.

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

~2,800 lines total. The only shared UI code is `packages/console-kit`
(`ReleasePicker.vue` + a status helper) — nothing for the list/detail/add pattern itself.

## 2. The duplication

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

## 3. Recommendation

Extract the shared shape into `console-kit`, parameterized by data/fields, and have each
kind plugin supply configuration instead of markup:

- **`MediaCardGrid`** — the list-page card grid (movies/series/music/podcasts/books lists
  are near line-for-line identical already).
- **`MediaDetailShell`** — header + metadata + actions layout used by all five detail pages.
- **`AddMediaFlow`** — search → pick → configure-fields → submit, with the configure step
  as a slot for kind-specific fields (quality profile, monitor mode, season folders, etc.).

Start with the list grid — it's the least kind-specific of the three and the biggest
line-for-line match — then detail, then the add flow (which has the most per-kind
variance and should stay last).

## 4. Tradeoff

Extracting shared components costs real short-term work: touching all five plugins,
finding the actual variance points vs. accidental drift, and getting the slot/prop API
right so the next media kind (audiobooks, whatever comes after music) doesn't need a sixth
copy. The alternative — a CSS/visual pass over the existing five copies — is faster and
lower-risk, but doesn't stop the duplication from growing; it just makes today's five
copies look more alike until the next edit.

## 5. Status

Not started. No milestones yet — this is scoping, not a commitment.
