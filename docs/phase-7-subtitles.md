# Phase 7 — Subtitles / Bazarr replacement

**Status: built, with a few items open.** `plugins/subtitles` (profiles and assignments,
embedded and sidecar inventory, wanted sweeps, scoring, protected upgrades, blocklist,
journaled installs with undo, offset and external sync, console and `/api/v1/subtitles`),
`plugins/subtitles-opensubtitles` and `plugins/subtitles-subdl`. The design text that used
to be here is gone; the code and its schema (`plugins/subtitles/src/schema.ts`) are the
reference.

## Still open

- Provider adapters `subtitles-podnapisi` and `subtitles-addic7ed`. Validate provider
  access before promising them (gate below).
- Bazarr migration (below).
- External sync supports SRT only; other formats can only use offset adjustment. Pick a
  packaged sync engine (gate below).
- Tests: only `plugins/subtitles/tests/scan.test.ts` exists. Not covered: scoring and
  identity rejection, quota and provider isolation, archive traversal and oversize
  downloads, encoding failures, crash recovery at each install stage, concurrent
  manual/automatic replacement, undo, sync validation.
- Image subtitles are inventoried but not converted; anime absolute numbering and episode
  packs are not handled.
- Typecheck errors predating the media-info work (see [media-info.md](media-info.md)).

## Deferred migration and implementation gates

Bazarr migration follows the native lifecycle: read a copied DB/config, preview profile
and path mappings, import supported settings through subtitle owner APIs, then rescan
actual files. Existing sidecars remain unmanaged until explicit adoption; source scores
do not become trusted Magpie scores. Provider secrets require explicit handling/re-entry.

Before 7b, verify the current [OpenSubtitles REST contract](https://opensubtitles.stoplight.io/docs/opensubtitles-api),
authentication, app key requirements, hash algorithm, and account quota responses using
official documentation and fixtures. Validate provider access for subsequent adapters
before promising them. Before 7e, choose a packaged sync engine based on format support,
license/distribution requirements, Windows support, and resource use. These are delivery
gates, not reasons to postpone inventory/profiles work.
