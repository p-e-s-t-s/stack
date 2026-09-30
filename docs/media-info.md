# Media info: real file facts on pages and in decisions

Not a phase; a plan to probe every library file with ffprobe, show the result on movie and
episode pages, and then (optionally) let the rest of Magpie use it: subtitles reading
the same facts instead of keeping its own copy, and the decision engine scoring the
**actual file** rather than only what the release name claimed.

## Status

**Built:** `@magpiejs/probe`, `@magpiejs/media-tools`, `@magpiejs/mediainfo` (steps A1, A3, A4)
and subtitles reading from it (B1, B2). Not built: A2 (needs `verify`), A5 (list filters),
B3 (drop `facts` in a later release), and all of Phase C.

How it differs from the text below:

- **Series page:** there is no `episode-row` slot. The panel sits in the existing
  `series-detail` slot, one card per file, with badges for the episodes the file holds
  (`S01E02`). That needed no change to the series client.
- **Subtitles keeps its `probes` row** (`generation`, `error`, `scannedAt`): the scan logic
  and its inventory rows are tied to `generation`, and "scan succeeded" is `row exists and
no error`. Only the `facts` column is abandoned (no longer written, typed `unknown`); a
  later migration drops it. Nothing else of subtitles' schema changed.
- **ffprobe setting moved out of subtitles.** `media-tools` adopts a path that subtitles had
  saved under its old `tools` setting on first start. The subtitles page now only has the sync
  engine settings and links to Settings → Media tools.
- **`@magpiejs/database` reads both drizzle-kit layouts** (`meta/_journal.json` + `<tag>.sql`,
  and the newer `<timestamp>_<name>/migration.sql` folders). Without this the subtitles plugin,
  whose migrations use the newer layout, could not start, and `npm run db:generate` produced
  migrations the runner could not read. `check:ownership` now covers both layouts.
- **Probing is throttled** to two files at a time inside the plugin, on top of the job queue's
  own limit, and a file that fails to probe is retried after 7 days (or when it changes).

Known issues found on the way, not fixed: `plugins/subtitles`, `subtitles-subdl` and
`subtitles-opensubtitles` already had about 60 TypeScript errors before this work
(`SubtitleCandidate` and `SubtitleProvider` in `@magpiejs/types` lack fields the plugins use),
and subtitles had no tests before `plugins/subtitles/tests/scan.test.ts`.

Builds on [post-download checks](post-download-checks.md), which introduces
`@magpiejs/probe` (pure package) and `@magpiejs/media-tools` (binary paths and health).

## 1. What exists

- No plugin stores media facts. `docs/PLAN.md` planned a `mediainfo` JSON on
  `media_files` and `docs/phase-3.md` §4.4 says ffprobe confirms codecs on import; neither
  exists. `library_media_files` (`plugins/library/src/schema.ts`) has quality, languages,
  release name and group, all copied from the release name.
- `subtitles` probes files itself (`probe()` in `plugins/subtitles/src/files.ts`, cached in
  its own `probes` table with a fingerprint "generation") and keeps only subtitle streams
  and duration.
- Page extension points exist: `movie-detail` (`movies/client/movie-detail.vue:170`),
  `series-detail` and `podcast-detail` slots, and the subtitles plugin already contributes
  a panel to `movie-detail`. Episodes have no per-row slot.
- Format scores are computed from the release name only (`decision/src/index.ts`
  `evaluator`). The score of the file on disk is whatever the grab's name-based score was
  (`grab.formatScore` copied into `library_media_files.format_score` at import).

## 2. Phase A: the `mediainfo` plugin and pages

### 2.1 Plugin

New `@magpiejs/mediainfo`, injecting `library`, `jobs`, `mediaTools`. It owns one table:

| Column        | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `file_id`     | PK, FK `library_media_files`, cascade                                         |
| `fingerprint` | size + mtime (+ short hash), same function as subtitles' "generation"         |
| `facts`       | JSON `ProbeFacts` (video, audio tracks, subtitle tracks, container, duration) |
| `error`       | probe failure text, null on success                                           |
| `probed_at`   |                                                                               |

- Probes in the background on `library/file-added`, and a daily reconcile job for files
  with no row or a changed fingerprint. Unchanged fingerprint means no re-probe.
- Never blocks import. If `mediaTools` reports no ffprobe the plugin records nothing and the
  UI says why.
- Service: `ctx.mediainfo.get(fileId)`, `ctx.mediainfo.list(mediaId)`, and a
  `mediainfo/updated` event.
- Reuse: [verify](post-download-checks.md) probes the download before placement. A hardlink
  keeps the same inode, size and mtime, so `mediainfo` accepts verify's facts when the
  fingerprints match and skips a second probe. Copies and moves (usenet) are re-probed.

### 2.2 Pages

- **Movies:** a media-info panel in the `movie-detail` slot: resolution, video codec and
  bit depth, HDR format, bitrate, container, duration, each audio track (codec, channels,
  language), each embedded subtitle track. Next to the release-name-derived quality badge,
  mismatches are flagged ("release said 2160p, file is 1080p").
- **Series:** add an `episode-row` slot to `series-detail.vue` and an expandable row with the
  same panel.
- **Shared component** `MediaInfoPanel.vue` in `packages/console-kit`, used by both and by
  the downloads queue (showing verify's facts of an in-progress download).
- **Lists:** filter and column options on the movie and series lists: resolution, HDR, audio
  language, "no English audio", "probe failed".
- Music, books and podcasts: out of scope for the first pass (different facts: bitrate,
  tags, duration).

### 2.3 Steps

| #   | Step                                              | Files                               | Size |
| --- | ------------------------------------------------- | ----------------------------------- | ---- |
| A1  | Plugin, table, probe-on-add, reconcile job        | `plugins/mediainfo`                 | M    |
| A2  | Reuse verify's facts when the fingerprint matches | `mediainfo`, `verify`               | S    |
| A3  | `MediaInfoPanel`, movie detail slot               | `console-kit`, `mediainfo/client`   | M    |
| A4  | `episode-row` slot, series panel                  | `series/client`, `mediainfo/client` | M    |
| A5  | List filters and columns                          | `movies/client`, `series/client`    | M    |

## 3. Phase B (optional cleanup): subtitles reads `mediainfo`

Subtitles currently probes each file and keeps a private copy. Once Phase A has shipped, it
can read from `mediainfo` instead, so each file is probed once and there is one place to
look.

- Subtitles keeps its own logic and tables for inventory, requirements and downloads. Only
  the **probe cache** moves.
- `subtitles.probeFile` (injectable in tests) becomes a thin read of
  `ctx.mediainfo.get(fileId)`; if no row exists yet it asks `mediainfo` to probe now and
  waits. Subtitles' scan already re-checks that the file did not change during the scan
  (`generation !== await fingerprint(path)`); the fingerprint function moves to
  `@magpiejs/probe` so both use the same definition.
- Subtitles adds `mediainfo` to its `inject`. Removing `mediainfo` then stops subtitles,
  consistent with how `media-tools` is handled.
- Migration: a new subtitles migration drops its `probes` table **one release after** the
  switch (released migrations are never edited). Until then the table is simply unused, so
  a rollback works.
- The subtitle-specific parts of the facts (stream language, forced/HI flags) are already in
  `ProbeFacts.subtitles`, so nothing subtitles reads is lost.

| #   | Step                                                               | Size |
| --- | ------------------------------------------------------------------ | ---- |
| B1  | Move the fingerprint helper into `@magpiejs/probe`                 | S    |
| B2  | Subtitles reads `mediainfo`; keep tests using an injectable source | M    |
| B3  | Drop `probes` in the following release                             | S    |

## 4. Phase C (optional): decision engine uses real facts

Today a custom format can only match the release **name** (`formatMatches` in
`decision/src/formats.ts` takes `parsed` and `info.title`). Release names lie, and they
don't tell you everything (real audio languages, real resolution). With `mediainfo`, the
file on disk can be scored on what it actually contains.

### 4.1 Two kinds of conditions

Conditions get a subject: `release` (today's, available for candidates and files) or
`file` (needs probe facts, so only available for files on disk). New file-subject condition
types: `actualResolution`, `actualVideoCodec`, `actualHdr`, `audioLanguage` (any track),
`audioCodec`, `audioChannels`, `bitrate` (per minute), `hasSubtitleLanguage`. They are
registered the way family conditions are (`FamilyCondition` in `families.ts`), with a
`subject: 'file'` marker.

A format containing any file-subject condition is a **file format**. For a release
candidate (a search result we haven't downloaded) file conditions are not applicable, and
the format doesn't apply, exactly like a condition of another family makes a format not
apply today (`test()` returns `undefined`).

### 4.2 Scoring a file

Each library file gets two scores:

- `formatScore` (existing): release-subject formats, comparable between a candidate release
  and the file. This keeps upgrade comparison (`isBetter`, the `upgrade` rule) working,
  because both sides are scored on the same kinds of conditions.
- `fileScore` (new, on `mediainfo`): the sum of file-format scores for this file's
  profile, computed after each probe.

Why two: comparing a file's probe-based score with a candidate's name-based score would
make every candidate look worse. File scores therefore don't take part in
candidate-versus-file comparison. They do two things:

1. **Floor:** if `formatScore + fileScore` falls below the profile's `minFormatScore`, the
   file is treated as not meeting the cutoff and the item becomes wanted again. This is
   how "no English audio track" or "actually 1080p despite a 2160p label" gets fixed
   automatically: give that file format a large negative score.
2. **Display:** the score breakdown on the media-info panel and in the explainer (see
   [release explainer](release-explain.md)).

### 4.3 Wiring

- `decision` gains `scoreFile(profileId, facts, releaseInfo)`: runs formats with file
  conditions enabled. `mediainfo` calls it after each probe and on profile or format
  changes (`decision/families` and format-saved events).
- `library_media_files.format_score` stays as is. `fileScore` lives in `mediainfo`'s table
  (new column) so `decision` and `library` ownership doesn't change.
- Cutoff and "wanted" logic (`movies` `needed()`, series equivalent) read
  `formatScore + fileScore` through a small `library.effectiveScore(file)` helper that
  asks `mediainfo` when present and returns `formatScore` otherwise, so nothing breaks when
  `mediainfo` is disabled.
- **Explainer:** file-subject conditions show as "not applicable to releases" on candidate
  explanations and with real results on file explanations.
- **Formats UI:** file conditions are labelled "file only" in the format editor, with a
  warning that they never match search results.

### 4.4 Steps

| #   | Step                                                                                  | Files                                    | Size |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------- | ---- |
| C1  | `subject` on conditions; `not applicable` handling in `formatMatches`/`explainFormat` | `decision/src/formats.ts`, `families.ts` | M    |
| C2  | File-subject condition types for the video family                                     | `decision/src/families.ts`               | M    |
| C3  | `scoreFile`; `fileScore` column; rescore on probe and on profile/format edits         | `decision`, `mediainfo`                  | M    |
| C4  | `library.effectiveScore`; movies and series cutoff logic use it                       | `library`, `movies`, `series`            | M    |
| C5  | Formats UI: "file only" labelling; explainer support                                  | `decision/client`                        | S    |

C depends on the explainer's `explainFormat` for step C1/C5; do that plan first.

## 5. Tests

- **A:** probe on add records facts; unchanged fingerprint isn't re-probed; changed
  fingerprint is; missing ffprobe records nothing and reports health; verify's facts reused
  on a hardlink import and ignored on a copy. Panel renders tracks, mismatch flag, probe error.
- **B:** subtitles scan works identically with `mediainfo` as the source (same fixtures as
  today, with an injectable source); a file changed mid-scan still fails the scan.
- **C:** a file format never matches a search result; the same format scores a probed file;
  a low `fileScore` makes the item wanted again and is shown in the explanation; release
  upgrade comparison is unchanged when file formats exist; everything degrades to
  `formatScore` when `mediainfo` is disabled.

## 6. Open questions

- **Backfill cost** on large libraries: probe rate limit and a "pause probing" switch so
  the first run on a NAS doesn't saturate the disks.
- **Should the floor apply automatically,** or only after the user opts a format in
  ("treat this format as a deal-breaker")? Default: opt-in per format.
- **File conditions and profiles in other families** (audio, ebook): start with video.
- **Two scores in the UI:** show one combined number with the breakdown on hover, or both
  always? Recommend one number plus breakdown.
