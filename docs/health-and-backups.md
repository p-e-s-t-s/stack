# Health checks and backups

Implements the first slice of Phase 9 in [PLAN.md](PLAN.md). Two plugins, both under
**System** in the console: `@magpiejs/health` and `@magpiejs/backup`.

## Health (`@magpiejs/health`)

`ctx.health.check(name, fn, { label, description, link })` registers a check for the
caller's lifetime. `fn(signal)` returns `{ level: 'ok' | 'warning' | 'error', message,
details? }`. The service runs every check side by side, five seconds after start, every
`intervalMinutes` (15) from a persisted job schedule, and on "Check now". A check that
throws or takes longer than `timeoutSeconds` (30) becomes an error rather than breaking the
pass. Results are kept in memory, one per check; nothing is stored, and checks only report.
`ctx.health.level()` is the worst level; `health/changed` fires after each pass.

Plugins are expected to register their own checks when they are loaded, which is how the
backup plugin adds "Backups". Checks health registers itself, each only while the service it
looks at is loaded:

| Check              | Warning                                          | Error                                                                     |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `database`         |                                                  | `PRAGMA quick_check` reports damage                                       |
| `jobs`             | a job ran out of retries in the last 24 h        |                                                                           |
| `root-folders`     | less free space than `minFreeGb` (10)            | missing, not a folder, not writable, or under a fifth of `minFreeGb` free |
| `indexers`         | none set up, or some are backing off             | all of them are backing off                                               |
| `download-clients` | none set up                                      | a client's `test()` fails                                                 |
| `download-paths`   | a finished download's folder is not visible here |                                                                           |

`download-paths` is the path-mapping sanity check. Magpie has no remote path mapping for
download clients yet, so a client reporting `/downloads/x` that Magpie cannot open (Docker
mounts that differ) shows up here, from grabs waiting for or refused by the import, instead
of as a failed import only.

REST: `GET /api/v1/health`, `POST /api/v1/health/run`.

## Backups (`@magpiejs/backup`)

A backup is `magpie-backup-<time>-<scheduled|manual>.zip` in the database's backup folder
(`data/backups`), next to the pre-migration `.db` snapshots, which keep their own retention.
It holds:

- `magpie.db`: a `VACUUM INTO` snapshot, consistent while Magpie runs;
- `magpie.yml`, unless turned off. It holds API keys and passwords in plain text;
- `manifest.json`.

Media files are not included. The zip is written by a small built-in writer (`zip.ts`; no
dependency) that standard `unzip` accepts. A backup is held in memory while it is written,
so a very large database needs that much RAM.

Settings (on the page, stored in `backup_settings`): on/off, every N hours (24), keep the
newest N (7), include `magpie.yml`. The schedule is a job; changing it reschedules. Files are
written under a temporary name and renamed, and a failure is shown on the page and as an
error on the "Backups" health check until the next success.

### Restoring

A running database cannot be replaced, so restoring is staged:

1. **Restore** on the page checks the zip (CRC, `PRAGMA quick_check`, has Magpie's
   migrations table) and puts `magpie.db`, and `magpie.yml` if asked, in `<config>/restore/`.
   Nothing changes yet, and the page offers **Cancel restore**.
2. On the next start, before plugins load, `applyStagedConfig` (app) swaps in `magpie.yml`,
   keeping the old one as `magpie.yml.before-restore`; `applyStagedDatabase` (database
   plugin, before the file is opened) saves the current database as
   `magpie-<time>-before-restore.db` and replaces it. Migrations then run as usual.

Restoring the `before-restore` snapshot (copy it over `magpie.db` while stopped) undoes it. A
backup made by a newer Magpie than the one running will fail to start with the existing
"plugin is older than its data" error; the snapshot is then the way back.

To restore onto a new install, put the zip in `data/backups/` and use the page. There is no
upload yet.

REST: `GET/POST /api/v1/backups`, `GET/DELETE /api/v1/backups/:name` (download, delete),
`POST /api/v1/backups/:name/restore` (`{ config }`), `DELETE /api/v1/restore` (cancel).

## Not done

- Restart button: the page says to restart Magpie; it cannot restart itself.
- Uploading a backup, and streaming (rather than in-memory) zips.
- Health checks from plugins that could supply them: media-servers reachability, subtitle
  provider quota, `media-tools` ffprobe missing.
- Notifying on a health change (the notifications plugin could subscribe to
  `health/changed`).
- Existing installs: `magpie.yml` is only filled with defaults on first start, so add
  `@magpiejs/health` and `@magpiejs/backup` to it by hand (or via Settings) to get the pages.
