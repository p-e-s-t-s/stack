# Plugin management: generalizing provider settings (Magpie plugins only)

Status: proposal. Nothing here is built.

## Goal

Keep what works today: a plugin's settings live **on the page for what it does**
(Indexers, Download clients, Metadata, Notifications, …), not buried in a generic plugin
config screen. Make that a general mechanism any Magpie plugin can use, instead of a
hard-coded list of six provider kinds. Also: show what is active or failing on the
existing Health page, let users switch media types on and off, and group the Settings
navigation so it stays scannable. The word "plugin" never appears in the UI. No YAML, no
shell, no Cordis names (PLAN.md §3.1).

## Scope

**Providers do not move, and plugin installation does not change.** Plugins stay npm
workspaces under `plugins/*`, exported as TypeScript source and listed in `defaultConfig()`.
No installer, registry, `<config>/plugins/` directory or third-party code. No change to how
the loader resolves packages or to the web console build.

Out: installing/updating/removing packages, arbitrary Cordis plugins, and
`@cordisjs/plugin-market` (PLAN.md §1 rules them out).

## What exists today

- Each domain page embeds one slot: `<k-slot name="provider-settings" :data="{ kind, status, test }" />`.
  Used by `plugins/indexers`, `downloads` (download clients), `metadata`, `subtitles`,
  `notifications` and `media-servers`.
- `plugins/settings` fills that slot. It scans `plugins/*` for `package.json →
magpie.provider`, loads each package's `Config` schema, renders a form (`fields.ts`), and
  adds/updates/removes loader entries in `magpie.yml` (`tree.create/update/remove`), which
  hot-loads that one plugin.
- The set of kinds is a closed union in `settings/src/index.ts`:
  `'indexer' | 'download-client' | 'metadata' | 'subtitle' | 'notifier' | 'media-server'`.
- `single` (one entry only, e.g. TMDB) and `basic` (fields shown up front) already exist.

The weak spots: a new kind means editing `settings`; only providers get this treatment;
nothing shows the whole picture (what's active, what failed); media types can't be switched
off without editing `magpie.yml`; and every settings page is listed flat in one
`configuration` navigation group (`PageNavigation` in `packages/console-kit/src/navigation.ts`
has `group`, `icon`, `default`, `aliases` and nothing finer), currently about twelve entries
from General to Import checks.

## Design

Four small generalizations plus one navigation change. Existing pages and provider
`package.json` files keep working unchanged.

### 1. Kinds are declared by the domain plugin, not by `settings`

The plugin that owns a page declares the kind it hosts, next to its code:

```jsonc
// plugins/indexers/package.json
"magpie": {
  "hosts": { "kind": "indexer", "label": "Indexers", "single": false }
}
```

`settings` builds its kind list from these declarations instead of the hard-coded union
(`ProviderKind` becomes `string`). A provider's existing `magpie.provider.kind` matches
against it. A kind with no host plugin installed isn't shown. Adding a new kind is then:
the domain plugin declares `hosts`, its page embeds the existing slot, providers declare
the kind. No `settings` change.

### 2. Any plugin with a `Config` can surface settings in a slot

Today only plugins with `magpie.provider` get the schema-driven form. Generalize to a
`magpie.settings` block with two modes:

```jsonc
"magpie": {
  "settings": {
    "slot": "provider-settings", // existing slot name; other pages may add their own
    "kind": "indexer", // placement, matched to a host (providers: same as today)
    "mode": "instances", // many entries (today's providers) | "single" (one config block)
    "label": "Torznab",
    "basic": ["name", "url", "apiKey"]
  }
}
```

- `instances` is exactly today's provider behavior. `magpie.provider` stays accepted as an
  alias, so no existing package changes.
- `single` is one config block edited in place (no "add"), for non-provider plugins that
  have a `Config` and a natural home on an existing page, e.g. a naming scheme or a backup
  schedule. This replaces hand-built forms only where the schema form is good enough;
  nothing is forced to migrate.
- Both use the same validation, secret masking, test hook and `settings/changed` event.

### 3. Status lives on the existing Health page, not a new "Plugins" page

No new navigation item and no "Plugins" screen. Users think in "Indexers" and
"Notifications", not plugins, and `/system/health` (`plugins/health`) is already where they
look when something is wrong. `settings` exposes a read-only summary that the Health page
renders as an **Integrations** section, each row linking to the page where it is
configured:

```ts
interface IntegrationStatus {
  label: string // "Torznab", "Discord", never a package name
  kind: string // a declared kind, e.g. 'indexer'
  state: 'active' | 'not-set-up' | 'disabled' | 'failed'
  instances: number
  route?: string // the domain page, e.g. '/settings/indexers'
  error?: string // plain-language message
}
```

- Built from existing data: `settings.providers()/entries()` and the loader's per-entry
  error state. A failed entry also becomes a health check using the health plugin's
  existing mechanism, so it surfaces wherever health already does.
- Read-only. Editing always happens on the domain page; there is no second place to
  configure.
- Lives in `plugins/settings` (`settings.integrations()`) and is consumed by
  `plugins/health`; no new plugin and no new ownership entry.

### 4. Media types are switches, not a plugin list

Turning Movies, TV, Music, Books or Podcasts on or off is a "which media do you use"
decision, so it is presented that way: a **Media types** section on the existing
`/settings/media` page (`plugins/library`), one switch per type with a short description.

- A switch sets or clears `disabled` on that type's loader entry, through the same loader
  call `settings.update` uses. `settings` exposes `setMediaType(name, enabled)`.
- Which plugins appear is declared, not guessed: the plugin opts in with
  `"magpie": { "mediaType": { "label": "Podcasts", "summary": "…" } }`. Core plugins
  (database, auth, api, jobs, …) have no such block, so they can't be switched off.
- An optional `magpie.needs` list warns before disabling something others depend on
  ("Downloads is used by Movies and TV").
- Switching off says plainly what happens: _Podcasts will be hidden and stop
  searching. Your library and files are kept._ Data is never deleted (PLAN.md: removal
  only after a backup, never automatic).
- Hidden means hidden: a disabled type's nav items, list pages and calendar entries go away
  because its client entry isn't loaded (to verify against how `webui` entries are removed on disable).

### 5. Settings navigation sections

Extend `PageNavigation` with an optional `section` for pages in the `configuration` group,
and have the Settings nav render a heading per section. The order of pages inside a
section stays the existing `order` value.

```ts
export interface PageNavigation {
  group: 'library' | 'activity' | 'configuration' | 'system' | 'other'
  /** Heading within Settings; pages without one fall under the group's first heading. */
  section?: 'library' | 'sources' | 'connections' | 'advanced'
  // …existing fields
}
```

| Section         | Pages                                           |
| --------------- | ----------------------------------------------- |
| General (first) | General                                         |
| Library         | Media, Profiles, Formats                        |
| Sources         | Indexers, Download clients, Metadata, Subtitles |
| Connections     | Notifications, Media servers                    |
| Advanced        | Media tools, Import checks                      |

- The mapping is one `section` value added to each page's `registerPage` call. No routes
  change, so links and bookmarks keep working.
- Labels are plain: rename Import checks to something task-based ("Download checks" or
  "Safety checks") and Media tools to "Video and audio tools" when the section is added.
  Naming is part of the change, not a follow-up.
- New plugins that register a configuration page without a `section` land under General,
  so nothing disappears.

## The "browser" is the per-page picker

Each domain page already has the picker: pick a provider of that kind, fill its form.
Keep that as the way to browse. Empty states say what's available ("No indexers yet. Add
Torznab…"). The Health page's Integrations section gives the cross-cutting view. If user installs are ever built,
new packages would simply appear in these same pickers, so this design doesn't block them
and doesn't depend on them.

## Lifecycle (existing mechanisms only)

| Action              | How                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Add instance        | existing `settings.add`, unchanged                                                          |
| Edit / disable      | existing `settings.update`, unchanged                                                       |
| Remove instance     | existing `settings.remove`, unchanged                                                       |
| Switch media type   | set or clear `disabled` on its loader entry; refuse if an enabled plugin's `needs` lists it |
| Failed load at boot | entry stays in `magpie.yml`, shown as **Failed** with the error; Magpie still starts        |

## Phasing

1. **Declare kinds.** Add `magpie.hosts` to the six domain plugins, derive kinds in
   `settings`, make `ProviderKind` a string. Pure refactor; pages and behavior unchanged.
2. **`magpie.settings` with `mode`.** Accept it alongside `magpie.provider`, add the
   `single` mode. Migrate no existing plugin.
3. **Settings navigation sections.** Add `section` to `PageNavigation`, tag the existing
   pages, render headings, rename the two vague pages. Independent of 1–2, so it can ship
   first.
4. **Integrations on Health.** `settings.integrations()`, a section on the Health page,
   failed entries reported as health checks.
5. **Media type switches.** `magpie.mediaType` opt-in, `setMediaType`, the section on
   `/settings/media`, optional `magpie.needs`.

## Testing

With `packages/testing`:

- Kinds come from `hosts` declarations; a provider whose kind has no host is not offered.
- `magpie.provider` and the equivalent `magpie.settings` block produce identical forms.
- `single` mode edits in place, rejects a second entry, masks secrets, and validates.
- `integrations()` reports correct state and instance counts; a plugin that throws on load
  is _Failed_ while the rest start, and produces a health check.
- `setMediaType` toggles an entry, refuses while a dependant is enabled, and refuses a
  plugin without a `mediaType` block (core plugins can't be switched off).
- Every page registered in the `configuration` group has a `section`, or lands under
  General; none is dropped from the nav.

## Deferred: user installs

Not part of this work; it would need its own proposal. What makes it separate: getting
packages onto disk and a second discovery location (`settings` is hard-wired to workspace
`plugins/*` siblings); third-party plugins would need compiled JS (built-ins export `.ts`);
console pages are built at Magpie build time; in-process third-party code needs a trust
model; ESM can't unload code and Magpie has no self-restart. PLAN.md reserves
`<config>/plugins/` for it.

## Open questions

1. Should `hosts` also carry the page route, so the Integrations rows can link without a
   lookup? (Proposed: yes, `route`.)
2. Final names for the two renamed pages, and whether "General" should be its own heading
   or sit unlabeled at the top.
3. Do Movies and TV need to stay together (they share downloads and profiles), or are they
   independent switches?
4. Which non-provider plugins, if any, are worth moving to `single`-mode forms? None are
   required by this proposal.
5. Keep `magpie.provider` as an alias forever, or deprecate it once `settings` exists
   everywhere?
