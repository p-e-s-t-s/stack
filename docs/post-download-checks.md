# Post-download sanity checks

Not a phase; a plan for verifying a finished download before it enters the library, so
fake, corrupt, mislabelled or malicious releases are rejected and the next-best release is
tried, instead of landing in the library and being noticed weeks later.

## Status

**Built:** everything in the plan. `@magpiejs/media-tools` and `@magpiejs/probe` (1a, 1b),
`@magpiejs/verify` with all ten checks (2, 3, 5, 7), the import guard and reject path (4),
and the console (6). How it differs from the design below is in §8.

## 1. What exists

- The download monitor moves a grab to `import_pending`; `ImportService.importGrab()`
  (`plugins/import/src/index.ts`) runs the kind's importer, which calls `tools.files()`
  to find the video and then `tools.place()`.
- `tools.files()` only checks that _a_ video file with the right extension exists
  (samples and extras are skipped by name). The only other check in the importer is
  "still an upgrade".
- Failure handling exists: `downloads.remove(id, { deleteData, blocklist })` blocklists a
  release and emits `downloads/failed`, and `movies/src/automation.ts` (and series)
  respond by searching for the next best release. `downloads/src/index.ts` `fail()` does
  the same for client-reported failures.
- `docs/phase-3.md` §4.4 says "`ffprobe`, if installed, confirms resolution and codecs"
  and `docs/PLAN.md` step 4 of import says ffprobe each file. **This isn't implemented in
  `import`.** The subtitles plugin has its own `probe()` (`plugins/subtitles/src/files.ts`)
  that keeps only subtitle streams and duration.

## 2. Design

### 2.1 Where it runs

**After the files are found and before anything is placed.** Nothing has touched the
library yet, so a rejection needs no cleanup.
Implementation: `ImportService` wraps `tools.files()` so the first call runs the checks
once and caches the result; a failing check throws before any importer logic runs.

### 2.2 Shared probe package

Extract `run()` and `probe()` from the subtitles plugin into `packages/probe`
(`@magpiejs/probe`) and extend it to return the full facts:

```ts
interface ProbeFacts {
  duration?: number
  container?: string
  video?: { codec: string; width: number; height: number; bitrate?: number; hdr?: string[] }
  audio: { codec: string; channels?: number; language?: string }[]
  subtitles: {
    index: number
    codec: string
    language?: string
    forced: boolean | null
    hi: boolean | null
  }[]
}
```

The package is pure: every function takes the binary path as an argument. The subtitles
plugin keeps its current API by delegating to it. Probes run with a timeout and the
existing abort-signal plumbing.

### 2.2.1 Media tools plugin

The binary location is its own setting, not part of subtitles (today `ffprobe` lives in
subtitles' `Config` and its `tools` settings row, next to the subtitle-sync binary). New
small plugin `@magpiejs/media-tools` (`plugins/media-tools`):

- Provides `ctx.mediaTools`: `ffprobe` and `ffmpeg` paths, `PATH` auto-detection, a
  version test, and a health status ("ffprobe 7.1 found" / "not found").
- Owns its settings in its own table and a Settings → Media tools page with a "Test"
  button.
- `verify` and `subtitles` both `inject: ['mediaTools']`. When a binary is missing,
  probe-based checks are skipped and the health notice says why.
- The subtitle-sync binary (`ffsubsync`/`alass`) stays in subtitles; it is subtitle-specific.
- Migration: on first start it seeds its path from any `ffprobe` value saved under
  subtitles' `tools` setting, then the subtitles page drops its ffprobe field, so existing
  installs keep working.

### 2.3 Check registry

New plugin `@magpiejs/verify`, owning `verify_results`, exposes
`ctx.verify.check(name, fn)` (registered through `ctx.effect`, like decision rules), so
other plugins can add checks. A check receives the grab, the library item, the found
files and a lazy `probe(file)`; it returns `pass`, or a finding with a severity.

```ts
type Finding = { severity: 'warn' | 'reject'; reason: string; detail?: unknown }
```

Built-in checks:

| Check             | What it catches                                                                                                                               | Needs ffprobe |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `executable`      | `.exe .scr .bat .cmd .msi .lnk .vbs .js .jar` in the download (the classic fake-release payload)                                              | no            |
| `no-media`        | only archives left (`.rar` parts, `.zip`), which means unextracted or password-protected; replaces today's bare "no video file found" message | no            |
| `size`            | file much smaller than the grab's reported `sizeBytes`, or a sample-sized file                                                                | no            |
| `container`       | ffprobe fails or finds no video stream (corrupt, truncated header)                                                                            | yes           |
| `duration`        | runtime differs from metadata by more than X% (movies: `runtimeMinutes`; episodes where known)                                                | yes           |
| `resolution`      | release claims 2160p/1080p but the stream is lower (fake upscale label)                                                                       | yes           |
| `codec`           | release claims x265/AV1 but the stream is x264                                                                                                | yes           |
| `audio-language`  | no audio track in a profile-wanted language when the release claimed one                                                                      | yes           |
| `bitrate`         | video bitrate implausibly low for the claimed quality (size/duration vs the quality-size definitions in `decision`)                           | yes           |
| `decode` (opt-in) | `ffmpeg -v error -t 10` over start and middle finds decode errors                                                                             | ffmpeg        |

### 2.4 Policy: severity and false positives

False rejections cost more than false accepts, so **defaults are conservative**:

- Reject by default only for `executable`, `no-media`, `container`.
- `duration`, `resolution`, `codec`, `audio-language`, `bitrate` default to **warn**:
  shown on the grab and in history, no rejection. Each can be switched to reject or off in
  Settings → Media management → Import checks, with its threshold (duration tolerance
  default 10%, extended edition aware via `parsed.edition`).
- Manual grabs (`grab.manual`) and manual imports never auto-reject; findings are warnings
  the user can see.
- If ffprobe is missing or times out, probe-based checks are **skipped**, not failed, and a
  health notice says so.
- Multi-file downloads: check the file chosen for import, plus the whole folder for
  `executable`/`no-media`.

### 2.5 Reject path

On a `reject` finding:

1. `downloads.remove(grabId, { deleteData: true, blocklist: true, reason })`. The
   blocklist reason is currently hardcoded to "removed by you"; add a `reason` option.
2. The existing `downloads/failed` handler (movies, series, music, books) searches for the
   next best release. The blocklist rule already excludes the bad one.
3. History gets `import-rejected` with the finding; a notification event is emitted for
   the notifier plugins.

Because a hardlinked file is still in the download folder when checks run, deleting the
download data removes it completely.

### 2.6 Recording results

`verify_results(grabId, file, probe JSON, findings JSON, outcome, createdAt)`. Keeping the
probe facts means the downloads UI can show "actual: 1080p x265 DDP 5.1, 1h52m" next to
the release name, and later a library health scan can reuse the same checks.

## 3. UI

- Downloads/queue row: a check badge (passed / N warnings / rejected) that expands to the
  findings and the probed facts.
- Settings → Import checks: per-check off / warn / reject and thresholds, plus a "test a
  file" box that runs the checks on a path.
- History: `import-rejected` events with the reason.

## 4. Work breakdown

| #     | Step                                                                                      | Files                                          | Size |
| ----- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- | ---- |
| 1a ✅ | `media-tools` plugin: paths, detection, health, settings page, seed from subtitles        | `plugins/media-tools`, `subtitles`             | S    |
| 1b ✅ | `@magpiejs/probe`: extract and extend; subtitles delegates                                | `packages/probe`, `subtitles/src/files.ts`     | M    |
| 2 ✅  | `verify` plugin: registry, results table, settings                                        | `plugins/verify`                               | M    |
| 3 ✅  | No-ffprobe checks: `executable`, `no-media`, `size`                                       | `plugins/verify`                               | S    |
| 4 ✅  | Wrap `tools.files()` in `import`; reject path; `reason` option on `downloads.remove`      | `import`, `downloads`                          | M    |
| 5 ✅  | Probe checks: `container`, `duration`, `resolution`, `codec`, `audio-language`, `bitrate` | `plugins/verify`                               | M    |
| 6 ✅  | UI: queue badge, settings, history                                                        | `downloads/client`, `verify/client`, `history` | M    |
| 7 ✅  | `decode` deep check (opt-in)                                                              | `plugins/verify`                               | S    |

Steps 1a–4 deliver the highest-value checks (`executable`, `no-media`, `container`)
without any warn/reject tuning.

## 5. Tests

- Fixture downloads in a temp directory: an `.exe`-only folder, a `.rar`-only folder,
  a zero-byte file, a truncated video, a tiny sample: each yields the expected finding.
- Probe checks use an injectable `probe` (as subtitles does with `probeFile`) fed canned
  `ProbeFacts`, so tests need no ffprobe binary. One opt-in test runs a real ffprobe on a
  generated clip when available.
- Policy: warn findings don't block; reject findings call `downloads.remove` with the
  blocklist reason and trigger the next-best search (fake Torznab, as in the Phase 3
  end-to-end test); manual grabs only warn; missing ffprobe skips and reports health.
- Runs before placement: after a rejection the library and filesystem are unchanged.
- Duration check respects extended editions and unknown runtimes.

## 6. Open questions

- **Episode runtime** isn't stored consistently for series; start with movies for
  `duration` and add series where metadata has a runtime.
- **Reject vs hold:** should a rejected-but-ambiguous download (for example a duration
  mismatch) go to a review queue for the user instead? That needs a new `import_held`
  state; recommend deferring until the warn-only data shows real false-positive rates.
- **Decode check cost** on large remuxes and NAS disks: keep opt-in and bounded to a few
  seconds of media.
- **Reporting back to indexer/group quality:** counting rejections per indexer or release
  group could feed decision scoring later; out of scope here.

## 8. How it was built

- **`import` stays unaware of `verify`.** It has a guard registry, `ctx.import.guard(fn)`,
  and `tools.files()` runs the guards once on the first look at the files, before the
  "no video file found" error so `no-media` can explain it. A guard throws `ImportRejected`,
  which deletes the download, blocklists the release with the reason, emits
  `import/rejected` (history records `import-rejected`) and lets the existing
  `downloads/failed` handlers search again. If the client cannot delete the download, the
  grab becomes `import_failed` instead of being left importing. `downloads.remove` takes
  the new `reason` option.
- **Checks return problems; the policy gives them a severity.** Each check is `off`, `warn` or
  `reject`, defaults as in §2.4. A manual grab's rejections are recorded as warnings.
  A check that throws is logged and skipped.
- **Probe checks only look at video files** (the largest ten of a pack), so audio and book
  kinds are never failed for having no video stream. A missing ffprobe or a probe timeout
  skips them; ffprobe exiting with an error is the `container` finding.
- **Claims come from the parser** (`parse(grab.title)`): `resolution` compares widths (a
  letterboxed 1080p film is 1920 wide but short), `codec` maps `x265` to `hevc` and so on,
  `audio-language` runs only when the name carries a language tag, `bitrate` uses a floor per
  resolution rather than the decision plugin's size definitions.
- **`duration` needs a runtime and nothing stores one yet.** Kind plugins can supply it with
  `ctx.verify.runtime(item => minutes)`; until one does, the check does nothing.
- **The console** is one page, Settings → Import checks: a mode (off, warn, reject) per check
  with its description, the runtime tolerance, a "Try a file" box and the latest results. The
  box only accepts paths inside a library folder or a recent download, so the page cannot be
  used to run ffprobe on arbitrary paths. Each Activity row has an `activity-row` slot where
  `verify` shows its badge (passed, N warnings, rejected), the findings and what ffprobe found
  (`1080p · H264 · EAC3 6ch · 1h30m`). A rejected download leaves the queue at once, so its
  reason is in History (`import-rejected`), the blocklist and the recent results.
- **`decode` is off by default** and runs ffmpeg with `-xerror` on 10 seconds at the start and
  the middle of up to three files; a timeout counts as skipped, not failed.
- **The `duration` check** gets movie runtimes from the `movies` plugin. Series have no
  per-episode runtime on the download side yet, so episodes are not duration-checked.
- `verify_results` has no foreign key to the grab, since a rejected grab's record is the point.

## 7. Related

[Media info](media-info.md) stores the probe facts for library files, shows them on movie
and episode pages, and optionally feeds them to subtitles and the decision engine. It
reuses this plan's `@magpiejs/probe` and `media-tools`, and accepts `verify`'s facts for
hardlinked imports instead of probing twice.
