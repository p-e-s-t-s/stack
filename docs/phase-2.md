# Phase 2 — Release parser and decision engine

Detailed plan for Phase 2 of [PLAN.md](PLAN.md#phase-2--release-parser--decision-engine-pure-logic-heavily-tested).
Goal: given a release name from an indexer (plus its size, seeders, age) and a target
(what we want and what we already have), decide **accept or reject, with reasons, and a
score** — without any network, indexer or download client yet. Phase 3 wires this into
real searches.

## 1. Scope

**In:**

- `packages/parser` — pure function from a release name to structured fields.
- `plugins/decision` — qualities, quality definitions (sizes), quality profiles, custom
  formats, language settings, release restrictions, scoring, upgrade/cutoff logic, and a
  registry of decision rules that other plugins can extend.
- Web console pages: a **Parse tester** and editors for **quality profiles** and **custom
  formats**.
- A fixture set of real release names with expected results.

**Out (later phases):**

- Matching a release to a specific movie/episode in the library (Phase 3, needs
  `library`). Phase 2 ships the title-normalization helpers it will use.
- Rules that need other plugins' data — blocklist and "already in the download queue"
  — are registered by `downloads` in Phase 3 through the rule registry built here.
- TRaSH Guides import (Phase 5).

## 2. `packages/parser`

### 2.1 API

```ts
parse(name: string, options?: { kind?: 'movie' | 'series' }): ParsedRelease
normalizeTitle(title: string): string          // for matching in Phase 3
```

Pure, synchronous, never throws, no dependencies. Target speed: 10,000 names in under a
second (RSS batches).

```ts
interface ParsedRelease {
  input: string
  title: string                 // cleaned title, e.g. "The Matrix"
  year?: number
  kind: 'movie' | 'episode' | 'season' | 'unknown'
  episodes?: {                  // series only
    season?: number             // undefined for absolute-numbered anime
    numbers: number[]           // [1, 2] for S01E01E02; [] for a full season pack
    absolute?: number[]         // anime
    airDate?: string            // daily shows, ISO date
    seasons?: number[]          // multi-season packs S01-S03
    special?: boolean
  }
  resolution?: '480p' | '576p' | '720p' | '1080p' | '2160p'
  source?: 'cam' | 'telesync' | 'telecine' | 'workprint' | 'dvd' | 'hdtv'
         | 'webrip' | 'webdl' | 'bluray'
  modifiers: ('remux' | 'brdisk' | 'rawhd' | 'regional' | 'screener')[]
  revision: { version: number; real: number; proper: boolean; repack: boolean }
  video: { codec?: 'x264' | 'x265' | 'av1' | 'vc1' | 'mpeg2' | 'xvid'; bitDepth?: 8 | 10;
           hdr: ('dv' | 'hdr10' | 'hdr10plus' | 'hlg' | 'sdr')[]; threeD?: boolean }
  audio: { codecs: string[]; channels?: string; atmos?: boolean }   // 'truehd', 'dtshdma', 'ddp', 'aac'…
  languages: string[]           // ISO 639-1; 'multi' when tagged MULTi
  edition?: string              // "Director's Cut", "Extended", "IMAX"…
  streamingService?: string     // 'amzn', 'nf', 'dsnp', 'atvp', 'hmax'…
  group?: string
  hardcodedSubs?: string        // 'hc', 'korsub'… (usually rejected)
  flags: ('hybrid' | 'obfuscated' | 'sample' | 'extras')[]
  /** Which part of the input produced each field; shown in the Parse tester. */
  spans: { field: string; start: number; end: number; text: string }[]
}
```

### 2.2 How it works

A tokenizer rather than one giant regex, so each rule is small and testable:

1. **Normalize**: strip file extension and known junk suffixes (`[rarbg]`, `[eztv]`,
   `-Obfuscated`), unify separators (`.`, `_`, spaces) while keeping positions, detect
   anime layout (`[Group] Title - 12 [1080p]`).
2. **Match tokens** with an ordered list of small matchers (episode markers, year,
   resolution, source, codec, HDR, audio, language, edition, service, revision). Each
   records a span.
3. **Title** = the text before the first "stop" token (year or episode marker, else the
   first quality token), cleaned up. Handles titles containing years or numbers
   (`2001 A Space Odyssey 1968`, `1917 2019`, `9-1-1 S05E01`).
4. **Group** = the trailing `-GROUP`, or the leading `[Group]` for anime, excluding known
   non-groups (a codec, a language tag).
5. **Derive** `kind`, default source/resolution guesses (e.g. `Remux` implies Blu-ray),
   and flags.

### 2.3 Fixtures

A YAML file of release names with the fields we expect (only the fields that matter per
case):

```yaml
- name: The.Matrix.1999.2160p.UHD.BluRay.REMUX.HDR.HEVC.TrueHD.Atmos.7.1-GROUP
  title: The Matrix
  year: 1999
  resolution: 2160p
  source: bluray
  modifiers: [remux]
  video: { codec: x265, hdr: [hdr10] }
  audio: { codecs: [truehd], atmos: true, channels: '7.1' }
  group: GROUP
```

- **Hand-written cases** (~150) covering every rule and edge case, written from naming
  conventions, not copied from other projects.
- **Real names** (target ≥ 500 total at exit): a script,
  `scripts/collect-release-names.ts`, reads release names from sources you point it at —
  your own Radarr/Sonarr databases' history (read-only), or an indexer RSS feed — and
  writes *candidate* fixtures with the parser's current output. A person reviews and
  corrects them before they're committed. No code or test files from the GPL-3.0 *arr
  projects are used.
- **Property tests** (`fast-check`): the parser never throws, spans stay inside the input,
  and parsing is stable under separator changes (`.` vs space vs `_`).

## 3. `plugins/decision`

Namespace `decision`. Provides `ctx.decision`.

### 3.1 Qualities

A fixed, ordered list defined in code (not a table), from worst to best, e.g.
`cam`, `telesync`, … `webdl-1080p`, `bluray-1080p`, `remux-1080p`, … `remux-2160p`.
Each quality is a `(source, resolution, modifier)` combination, so the parser's output
maps to exactly one quality. Unknown combinations map to `unknown`.

### 3.2 Tables

| Table | Columns |
|---|---|
| `decision_quality_sizes` | quality, min / preferred / max MB per minute of runtime |
| `decision_profiles` | id, name, items (JSON: ordered qualities and groups, each allowed or not), cutoff quality, min format score, cutoff format score, upgrades allowed, languages (JSON), min seeders, min age minutes |
| `decision_custom_formats` | id, name, conditions (JSON, §3.3), include in file name |
| `decision_profile_scores` | profile_id → `decision_profiles`, format_id → `decision_custom_formats` (both `on delete cascade`), score |
| `decision_restrictions` | id, required terms, ignored terms (plain or `/regex/`), tags |

The first migration seeds default size limits and three profiles — **Any**, **HD
(720p/1080p)** and **Ultra HD** — through a data step.

### 3.3 Custom formats

A custom format matches when all its required conditions match and at least one of its
optional ones does (the usual semantics). Each condition can be negated.

| Condition | Matches on |
|---|---|
| `title` | regex on the release name |
| `group` | regex on the release group |
| `source`, `resolution`, `modifier` | parsed values |
| `edition` | regex on the parsed edition |
| `language` | parsed languages (or "original language" of the target) |
| `hdr`, `videoCodec`, `audioCodec` | parsed values |
| `streamingService` | parsed value |
| `size` | release size range in GB |
| `indexerFlag` | flags from the indexer (freeleech, internal…) |

A release's **format score** = the sum of the profile's scores for every format it
matches. Custom format definitions are stored as JSON that follows the same shape as
the ones people already share, so importing them (Phase 5) is a mapping, not a rewrite.

### 3.4 Rules and decisions

```ts
ctx.decision.evaluate(release: ReleaseCandidate, target: DecisionTarget): Decision

interface ReleaseCandidate { info: ReleaseInfo; parsed: ParsedRelease }   // ReleaseInfo from @magpiejs/types
interface DecisionTarget {
  kind: 'movie' | 'episode' | 'season'
  profileId: number
  runtimeMinutes?: number          // for size limits
  originalLanguage?: string
  episodes?: { season: number; numbers: number[] }
  current?: { quality: string; formatScore: number; revision: Revision }   // file on disk
}
interface Decision {
  accepted: boolean
  quality: string
  formatScore: number
  matchedFormats: string[]
  rejections: { rule: string; reason: string; permanent: boolean }[]
  /** Sortable key: quality rank, then format score, then revision, then tie-breakers. */
  rank: number[]
}
```

Rules are small functions registered with `ctx.decision.rule(name, fn)`, tied to the
registering plugin's lifecycle — the same pattern as job types. Phase 2 ships:

| Rule | Rejects when |
|---|---|
| `quality-allowed` | quality not allowed in the profile |
| `size` | size outside the quality's limits for the runtime (skipped without runtime) |
| `restrictions` | a required term is missing or an ignored term is present |
| `language` | none of the release's languages is in the profile's list |
| `min-format-score` | format score below the profile's minimum |
| `hardcoded-subs` | release has hardcoded subtitles (unless a format scores them positively) |
| `seeders` | torrent below the profile's minimum seeders |
| `min-age` | usenet release younger than the profile's minimum age |
| `episode-match` | season pack when a single episode is wanted and vice versa, or wrong season |
| `upgrade` | not better than the current file, or the current file already meets the cutoff |
| `sample` | release is a sample or extras-only |

Phase 3 adds `blocklist` and `in-queue` from the `downloads` plugin; later plugins can
add their own (for example a per-indexer rule).

**Upgrade logic:** a candidate is better if its quality rank is higher; at equal quality,
if its format score is higher; at equal score, if it's a newer revision (PROPER/REPACK/v2).
Upgrades stop once the current file reaches both the cutoff quality and the cutoff
format score, or if the profile disallows upgrades.

**Ranking** across accepted releases: quality rank, format score, revision, then
indexer priority, seeders (torrent) or age (usenet), then size closest to preferred.

## 4. Web console

- **Parse tester** — paste one or many release names; see each parsed field with the
  text it came from highlighted, the resulting quality, which custom formats match, and
  the decision against a chosen profile (optionally with a "current file" to test
  upgrades). This is also how we'll review collected fixtures.
- **Quality profiles** — list, create, edit: drag to order qualities, allow/deny,
  cutoff, format scores, languages, minimums.
- **Custom formats** — list, create, edit conditions, and test against a release name
  inline.
- **Quality sizes** — table of min / preferred / max per quality.

These live in the `decision` plugin's client entry, so disabling the plugin removes them.

## 5. Milestones

| # | Deliverable | Done when |
|---|---|---|
| 2a | Parser core: normalization, episodes, year, title, group | hand-written episode/title cases pass |
| 2b | Parser quality fields: resolution, source, modifiers, codecs, HDR, audio, languages, edition, service, revision | hand-written quality cases pass; property tests pass |
| 2c | `collect-release-names` script and first batch of real fixtures | ≥ 300 reviewed real names committed |
| 2d | `decision` plugin: qualities, tables, seeded defaults, custom format matching | unit tests for every condition type |
| 2e | Rules, upgrade logic, ranking, rule registry | unit tests for every rule in §3.4 |
| 2f | Parse tester page | usable end to end against real names |
| 2g | Profile, custom format and size editors | edits persist and take effect without restart |

2a → 2b → 2c are sequential; 2d can start alongside 2b; 2f needs 2d.

## 6. Exit criteria

- ≥ 500 reviewed fixtures pass, at least 150 of them series (standard, daily, anime,
  season packs, multi-episode).
- Parser handles 10,000 names in under a second.
- Every rule in §3.4 has unit tests, including upgrade and cutoff edge cases.
- The Parse tester and editors work in the production build.
- Typecheck, lint, format, ownership check and all tests pass in CI.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Release naming is messy; the long tail never ends | Fixture-driven: every bug report becomes a fixture. Parse tester makes failures visible. |
| Title extraction for names with numbers/years | Dedicated cases; year is only a stop token when a plausible title precedes it |
| Clean-room constraint (MIT) | Write matchers from naming conventions and our own fixtures; never open *arr parser code while implementing |
| Custom format semantics differ subtly from what users know | Document our semantics in the editor; Phase 5 importer maps and reports anything it can't |

## 8. Questions

1. **Real release names:** can you point the collection script at your existing
   Radarr/Sonarr databases (or give an indexer RSS URL)? It only reads release names
   from history, locally. Without it, we'd rely on hand-written cases for longer.
2. **Languages:** besides English, which languages matter to you? This sets detection
   priorities and the default profiles.
3. **Default profiles:** simple built-in profiles now and TRaSH-style custom formats via
   import in Phase 5 (recommended), or ship TRaSH-like formats by default now?
