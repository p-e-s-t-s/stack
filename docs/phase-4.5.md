# Phase 4.5 — Generic media kinds

Detailed plan for Phase 4.5 of [PLAN.md](PLAN.md#phase-45--generic-media-kinds). Goal: make
adding a new kind of media (podcasts, books, music) a matter of writing a new plugin,
without editing the core plugins each time. Nothing changes for users: movies and TV keep
working exactly as they do.

## 1. Why

Most of Magpie is already generic: plugins own their data, the library stores items and
files of any kind, downloads belong to any library item, import has one importer per kind,
and metadata, settings, jobs, history and the web console don't care what the media is.

Three things are not:

- **Judging releases is video-only.** The parser reads video release names (resolution,
  source, `S01E02`), qualities are video qualities, profiles rank those, and size limits are
  megabytes per minute of video.
- **Movies and TV are named in shared code.** `MediaKind` is `'movie' | 'series'`; Torznab
  has fixed movie and TV category settings; naming templates are one object with movie and
  series fields; the import helpers look only for video files; the calendar reads the movies
  and series plugins directly.
- **Downloads assume indexers.** Podcasts download straight from a feed, with no indexer,
  torrent or usenet involved.

## 2. What a media kind plugin provides

After this phase, a kind plugin (movies, series, and later podcasts, books, music) brings:

| Part                 | How it's registered                                          | Movies / series today          |
| -------------------- | ------------------------------------------------------------ | ------------------------------ |
| Kind id and labels   | `MediaKinds` interface, extended by declaration merging      | hardcoded union                |
| Metadata             | provider `kinds` (unchanged)                                 | TMDB                           |
| Qualities and parser | a **quality family** in `ctx.decision.family()`              | built-in video family          |
| Indexer search       | a **search type** (Newznab `t=`, fields, default categories) | hardcoded in `indexer-torznab` |
| Naming               | templates and tokens in `ctx.library.naming.register()`      | fields of one `Naming` object  |
| Import               | importer + file extensions in `ctx.import.register()`        | importer only (video files)    |
| Calendar             | a source in `ctx.calendar.source()`                          | read directly by `calendar`    |
| Pages                | its own web console entry (unchanged)                        | own pages                      |

## 3. Changes

### 3.1 Types (`@magpiejs/types`)

- `MediaKind` becomes `keyof MediaKinds`, an interface each kind plugin extends:
  `declare module '@magpiejs/types' { interface MediaKinds { podcast: true } }`.
- `Protocol` gains `'http'`: direct downloads from a URL (podcast episodes, free books).
- `ReleaseQuery` gains `fields?: Record<string, string>` for search types with named
  parameters (`artist`, `album`, `author`, `title`), next to `season`/`episode`.
- The metadata provider interface stays; kinds add their own optional methods
  (`getArtist`, `getAuthor`, `getFeed`…) by declaration merging, as movies and series do
  with `getMovie` and `getSeries`.

### 3.2 Decision (`@magpiejs/decision`)

- **Quality families.** `ctx.decision.family(id, definition)` registers a set of qualities
  (id, name, default order, groups), a release-name parser that returns the common facts
  (quality, group, revision/proper, languages, what it covers) plus family-specific ones,
  a size rule (`perMinute` for video and audio, `total` for books), extra custom-format
  condition types (resolution/codec for video, bitrate/bit depth for audio), and default
  profiles. The current video qualities and parser become the built-in `video` family;
  movies and series use it.
- **Profiles belong to a family.** `decision_profiles` gets a `family` column (default
  `video`, so existing profiles are unchanged). The Quality profiles page shows one tab per
  family; each kind picks profiles of its family.
- **Rules.** Generic rules (quality allowed, minimum score, restrictions, seeders, age,
  upgrade, blocklist) stay as they are. Video-only rules (hardcoded subtitles, episode
  match) apply only to the video family; size limits use the family's size rule.
- **Targets.** `DecisionTarget.kind` becomes a string, and `episodeIds` becomes `unitIds`:
  the parts of an item a release covers (episodes, albums, books).
- **Parsers.** The video parser stays in `@magpiejs/parser`. Audio and book parsers are
  added later as `@magpiejs/parser/audio` and `@magpiejs/parser/book`, each with its own
  golden fixtures (collected the same way as the video ones).
- The Release name tester gets a family selector.

### 3.3 Indexers (`@magpiejs/indexers`, `@magpiejs/indexer-torznab`)

- `ctx.indexers.searchType(kind, { newznab: 'movie' | 'tvsearch' | 'music' | 'book' |
'search', fields, defaultCategories })` lets each kind say how it is searched.
- Torznab reads `music-search` and `book-search` capabilities, and replaces
  `movieCategories`/`tvCategories` with `categories` per kind. Existing `magpie.yml`
  entries keep working: the old fields are read as the movie and series categories.
- RSS reads the categories of every kind that is enabled.

### 3.4 Library (`@magpiejs/library`)

- Root folder `kind` is any registered kind (the column is already plain text).
- Naming becomes per kind: `ctx.library.naming.register(kind, { templates, tokens })`
  with settings stored as `naming:<kind>`. A migration moves today's movie and series
  templates there. Hardlinks and the recycle bin stay global. Media management shows a
  naming section per registered kind, listing that kind's tokens.

### 3.5 Import and downloads

- `ctx.import.register(kind, importer, { extensions })`: the shared tools find files by the
  kind's extensions (`findFiles`), and skip samples only for video.
- `@magpiejs/downloads` accepts `http` grabs; a direct-download client plugin comes with
  podcasts (Phase 4.6). The movie-only "already downloading" rule applies to kinds without
  units; kinds with units register their own, as series does.

### 3.6 Calendar

- `ctx.calendar.source(kind, (from, to) => CalendarEntry[])`. Movies and series register
  their sources, moving that code out of the calendar plugin; podcasts, books and music add
  theirs later.

## 4. Proof: a test kind

The exit test registers a small **fixture kind** from a test file, with no changes to core
plugins: its own quality family (two qualities and a tiny parser), a search type, naming
templates, an importer for `.txt` files and a calendar source. It goes search → grab →
import through the real indexers, downloads and import plugins. If it needs a core change,
the phase isn't done.

## 5. Milestones

| #    | What                                                                            |
| ---- | ------------------------------------------------------------------------------- |
| 4.5a | Open `MediaKind`; `http` protocol; `ReleaseQuery.fields`; `unitIds`             |
| 4.5b | Quality families; profiles per family (migration); family-aware rules and pages |
| 4.5c | Search types; Torznab categories per kind (reads old config)                    |
| 4.5d | Naming per kind (migration); import by extensions; calendar sources             |
| 4.5e | Fixture-kind test; all existing tests pass unchanged                            |

## 6. Exit criteria

- All existing tests pass without changes to their expectations.
- An existing `magpie.yml` and database upgrade without manual steps.
- The fixture kind goes search → import without touching core plugins.

## 7. Status

Done. What changed against this plan:

- Naming migration is a read fallback: values saved in the old combined `naming` setting are
  read until a kind's naming is saved again, so no data step was needed.
- The movie importer moved from `@magpiejs/import` into `@magpiejs/movies`, so the import
  plugin has no knowledge of any kind.
- Kinds also declare themselves with `ctx.library.registerKind()` (label for root folders
  and settings), and calendar entries carry the web console link they open.
- The fixture kind lives in `packages/app/tests/fixture-kind.test.ts`.

## 8. Decisions

- **Quality families, not per-kind qualities.** Movies and TV share video qualities;
  ebooks and audiobooks are separate families even though both belong to books.
- **No renumbering.** The new kinds are Phases 4.6–4.8 so later phase numbers (and the
  documents that refer to them) stay the same.

## 9. Open questions for the kind phases

- Audiobooks inside the books plugin (like Readarr) with their own root folder, or a kind
  of their own? The plan assumes inside books.
- Podcast search: iTunes Search (no key) is assumed; Podcast Index needs a free key.
- Music tagging: writing ID3/Vorbis tags on import is left optional for Phase 4.8.
