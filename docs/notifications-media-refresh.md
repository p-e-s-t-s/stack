# Notifications and media-server refresh

Implementation plan for the Phase 8 integrations in [PLAN.md](PLAN.md).
Status: proposed; this document does not implement the integrations.

## Outcome and scope

After a successful import, Magpie can notify configured destinations and tell Plex,
Jellyfin, or Emby to discover the changed files. External failures never turn a successful
import into a failed import. Each destination has independent filtering, retries and
delivery history. Multiple instances of every provider are supported.

First release: Discord, SMTP email, generic webhook, ntfy, Plex, Jellyfin and Emby.
Telegram follows through the same notifier contract. Later additions can include
Gotify, Pushover, Slack and Apprise without changing media plugins. This feature concerns
library updates, not installing or upgrading media-server software.

## Existing foundations and gaps

- `packages/types` already defines `NotificationEvent` and `Notifier`; extend these
  contracts rather than introducing another incompatible notifier API.
- `plugins/jobs` persists work and retries, but its dedupe key only covers pending and
  running jobs. A finished delivery needs its own durable uniqueness constraint.
- Provider configuration already supports multiple instances through `plugins/settings`
  and package `magpie.provider` metadata. Add notification and media-server groups there.
- Automatic imports emit `import/completed` and `import/failed`. `ImportResult.path`
  describes only the first file of a pack; refresh requires the complete changed-file set.
- Manual imports, rescans and repairs use `ReviewService` and write history directly.
  They must enter the same committed-change flow as automatic imports.
- `library/file-added` can run inside a transaction and also represents updates.
  Sending from that event would risk premature sends and duplicate import notices.

## Plugin boundaries

| Package | Responsibility |
| --- | --- |
| `@magpiejs/events` | Durable domain-event journal, append and cursor-based reads |
| `@magpiejs/notifications` | Notifier registry, routing, delivery rows, jobs and console |
| `@magpiejs/notifier-{discord,email,webhook,ntfy,telegram}` | Configuration, test and transport |
| `@magpiejs/media-servers` | Server registry, path mapping, refresh batches, jobs and console |
| `@magpiejs/media-server-{plex,jellyfin,emby}` | Connection discovery and server-specific requests |

Each plugin owns prefixed tables and migrations. Providers register through a
`ctx.effect` lifetime and disappear cleanly when disabled. Media-kind plugins supply
optional display context, such as episode or album labels; neither orchestrator depends
on movies or series. Providers expose capabilities and consume immutable snapshots.

## Durable events and import completion

Add a versioned envelope: `id`, `schemaVersion`, `type`, `occurredAt`, `operationId`,
optional `mediaId`, `kind`, title and structured data. Media-change data includes origin
(`download`, `manual`, `rescan`, `repair`), all added/updated/removed paths, file IDs,
replacement status and optional episode/album context. Use stable operation IDs:
download grab plus import generation, or review session plus stable row ID. Keep local
paths in internal events; public notification serialization omits them by default.

The journal owns `events_journal`; consumer plugins own their delivery rows and cursors.
Append event intents in the same SQLite transaction as the final authoritative domain
state. Confirm all plugin database handles share transaction participation before
implementation; expose a database unit-of-work if they do not. An in-memory listener
followed by an enqueue is insufficient to close the crash window.

Filesystem placement and SQLite cannot commit atomically. Persist operation progress,
then finalize domain state and journal intent together after placement and required
cleanup. Recovery reconciles interrupted operations using their stable IDs. Capture
success outside the current import error boundary so a consumer error cannot mark an
already imported grab failed. Do not perform external I/O in import code or transactions.

Consumers atomically advance their journal cursor with insertion of matching delivery
or refresh intents. A periodic sweep queues any intents lacking runnable work, covering
crashes between intent insertion and job enqueue. Initial activation starts at the current
journal position; replay is explicit. A temporary shutdown resumes from the saved cursor.

Commit individual successful review rows even if other rows fail. Group their notices
by operation where appropriate. Rescan and repair notices are opt-in and refresh only
actual filesystem changes, not bookkeeping changes. Preserve existing history behavior
without subscribing to both history and import events for the same operation.

## Notification routing and delivery

Initial event catalog:

| Event | Default |
| --- | --- |
| `media.imported` | Enabled; one summary per import operation |
| `media.upgraded` | Enabled; distinguish replacement from first import |
| `download.failed`, `import.failed` | Enabled; suppress repeated identical failure state |
| `download.grabbed` | Opt-in |
| `media.deleted` | Opt-in; physical deletion and catalog removal remain distinct |
| `health.changed`, `subtitles.completed` | Reserved until their owning features land |

Extend `Notifier.send` with delivery context containing delivery ID and abort signal;
add a separate `test()` capability. Configured event subscriptions and filters belong
to the destination, while provider capabilities describe supported event types. Filters
include kinds, root folders, event types and manual/automatic origin. Evaluate routing
when consuming the event and persist the decision so retries do not select new targets.

`notifications_deliveries` stores event ID, stable destination instance ID, status,
attempts, due time, sanitized error and timestamps. Enforce unique event/destination
pairs. Jobs carry only delivery IDs, never credentials. Resolve current credentials at
execution; removed destinations cancel pending work, disabled destinations pause it.
Endpoint changes cancel old queued deliveries unless the user explicitly replays them.

Use bounded timeouts, exponential backoff with jitter and provider Retry-After support.
Retry timeouts, connection failures, 429 and transient 5xx; classify authentication and
payload failures as requiring action. Proposed defaults: five attempts, 30-second base,
15-minute cap, 30-day delivery retention. Keep dedupe tombstones through the replay window.

Delivery is at least once: a crash after remote acceptance can repeat a message.
Generic webhooks expose event and delivery IDs for receiver deduplication; email uses a
stable Message-ID. Neither email nor Discord promises exactly-once delivery. Explicit
resend creates a separately identified delivery linked to the original.

### Provider behavior

- Discord: incoming webhook URL, optional thread and display name; bounded embeds,
  escaped text, mentions disabled, and response confirmation using `wait=true`.
  [Official webhook documentation](https://docs.discord.com/developers/resources/webhook).
- Email: SMTP host/port, implicit TLS or required STARTTLS, username/password, sender
  and recipient list. Use a maintained SMTP library, text plus escaped HTML, and reject
  header injection. Do not disable certificate verification.
- Webhook: fixed POST with versioned JSON, optional bearer authentication and custom
  headers. Optional HMAC-SHA256 signs timestamp plus exact body bytes; document header
  names, freshness validation and delivery IDs. No executable templates or shell commands.
- ntfy: configurable server, topic, optional token, title, priority and tags. Support
  self-hosted deployments; avoid topics or authentication values in logs.
  [Official publishing documentation](https://docs.ntfy.sh/publish/).
- Telegram follow-up: bot token and chat/topic ID with escaped message formatting.

## Media-server refresh

Define `MediaServerProvider` separately from `Notifier`: stable instance ID,
`test()`, library discovery, capabilities and `refresh(batch, context)`. A success means
the server accepted the request; it does not mean scanning or metadata matching finished.

Each instance configures URL, token/API key, selected libraries, kinds/root folders,
per-server path mappings, debounce and explicit broad-scan fallback. Never reuse download
client path mappings: these convert Magpie's final library paths to the server's paths.
Honor URL base paths for reverse proxies.

Map by longest matching directory prefix with segment boundaries, source-platform case
rules and target-platform separators. For example, `D:\\Media\\Movies` can map to
`/media/movies`; `MoviesExtra` must not match `Movies`. Reject traversal, ambiguous
configuration and unmapped paths. No mapping is needed when both systems use identical
paths. Show translated paths in the connection test.

| Server | Intended strategy | Implementation verification |
| --- | --- | --- |
| Plex | Discover sections, scan selected section with a changed-directory path where supported | Confirm HTTP method and scoped path behavior per supported version; current developer reference and older support examples differ |
| Jellyfin | Report changed paths using `POST /Library/Media/Updated` | Verify request DTO, authentication and update types against a pinned release OpenAPI and live server |
| Emby | Report changed paths using `POST /Library/Media/Updated` | Verify accepted update types and authorization against supported versions |

Primary references: [Plex developer API](https://developer.plex.tv/pms/),
[Plex scan commands](https://support.plex.tv/articles/201638786-plex-media-server-url-commands/),
[Jellyfin controller source](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/LibraryController.cs),
[Emby changed-media endpoint](https://dev.emby.media/reference/RestAPI/LibraryService/postLibraryMediaUpdated.html).
Jellyfin's API documentation could not be fetched during planning; exact versioned
contracts remain an implementation gate. Do not assume Jellyfin and Emby are identical.

Persist changed paths in `mediaservers_refresh_intents`; group by destination/library.
Default debounce is 15 seconds, with a 60-second maximum wait during continuous imports.
Deduplicate paths, cap batch size and serialize requests per server. Snapshot batch
membership when a job starts. Changes arriving during a running scan belong to the next
batch; the jobs queue's existing-key behavior must never swallow their paths.

Scan final destinations only after committed successful import or upgrade. Include all
pack files, and removed old paths when a replacement changes location. Physical delete,
rename and subtitle changes can join this flow once their producers provide committed
events. Unsupported kinds or libraries are skipped with a visible reason.

Scoped refresh is preferred. Broad scans require explicit instance configuration and
are coalesced and rate limited. Authentication, mapping and permission errors never
trigger broad fallback. Retrying a refresh is independent of notification delivery.

## Settings and activity UI

Add Settings pages for Notifications and Media servers using console navigation metadata.
Reuse provider configuration discovery for Add/edit/enable/remove and secret fields.
Notification cards show event filters, last success/error, pending count and Test message.
Server cards show discovered libraries, mappings, last accepted refresh and Test connection.
Connection tests never start a scan; a separate Test refresh names the exact library/path.

Activity details show queued, retrying, accepted/sent, failed, paused, cancelled or skipped
work, sanitized errors, next retry and Retry/Cancel actions. Test messages are clearly
marked and do not require adding real media. Check server-side admin authorization on
configuration, tests, history and retry commands. Paginate activity and enforce retention.

Secrets stay in existing provider configuration, with environment references where
supported. Never copy tokens, webhook URLs or SMTP credentials into events/jobs/activity.
Allow private-network destinations for self-hosted servers; restrict outbound requests
to configured HTTP(S) endpoints, reject embedded URL credentials and block cross-origin
redirects carrying secrets. Public webhook payloads exclude raw provider responses,
credentials, source paths and arbitrary internal event data.

## Implementation sequence and acceptance

1. **Contracts and durable capture.** Add event journal and stable operation identities;
   unify automatic/manual completion and full changed-file reporting. Test rollback,
   restart reconciliation, packs, partial manual success and replacement classification.
2. **Notification orchestration and webhook.** Add registry, filters, persistent delivery
   rows, sweep and activity UI. Prove crash recovery before enqueue and after acceptance,
   durable dedupe after job retention, disable/remove and destination edits.
3. **Discord, ntfy and email.** Add provider settings/tests and formatting. Use HTTP/SMTP
   fixtures for rate limits, timeout, bad credentials, TLS and malicious message content.
4. **Refresh orchestration and Plex.** Add mappings, discovery and persisted batching.
   Test Windows/Linux paths, reverse proxies, packs and imports arriving during a scan.
5. **Jellyfin and Emby.** Add independent adapters with pinned API fixtures, then opt-in
   live tests against documented supported versions. Prove configured-library isolation
   and that server outages never affect completed imports.
6. **Operational finish.** Add retention, admin authorization tests, redaction checks,
   setup docs and Telegram. Run repository typecheck, lint, formatting, ownership and
   relevant tests, plus a console smoke test of add/test/filter/retry flows.

Exit: one import reaches all matching enabled notification destinations and refreshes
only the intended media libraries; restart loses no committed intent; a destination
failure is visible and independently recoverable; adding another provider or media kind
requires no edits to the existing media-specific orchestrators.
