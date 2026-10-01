# Plugin management: generalizing provider settings (Magpie plugins only)

Status: proposal. Nothing here is built.

## Goal

Keep what works today: a plugin's settings live **on the page for what it does**
(Indexers, Download clients, Metadata, Notifications, …), not buried in a generic plugin
config screen. Make that a general mechanism any Magpie plugin can use, instead of a
hard-coded list of six provider kinds, and add a small overview for state and feature
toggles. No YAML, no shell, no Cordis names in the UI (PLAN.md §3.1).

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
and nothing shows the whole picture (what's active, what failed, which features are on).

## Design

Three small generalizations. Existing pages and provider `package.json` files keep working
unchanged.

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

### 3. A read-only overview, not a second place to configure

A **Settings → Plugins** page that lists plugins and their state, and **links to** each
plugin's own page rather than hosting its form:

```ts
interface PluginInfo {
  name: string
  label: string
  kind: string // a declared kind, or 'feature'
  state: 'active' | 'not-set-up' | 'disabled' | 'failed'
  instances: number
  page?: string // route of the domain page, e.g. '/settings/indexers'
  needs: string[]
  error?: string
}
```

- Built from existing data: `settings.providers()/entries()`, the non-provider entries in
  the loader tree, the loader's per-entry error state. Failures also go to the existing
  health plugin.
- **Features** section: toggles for built-in feature plugins (movies, podcasts, books, …),
  setting or clearing `disabled` on the loader entry. An optional `magpie.needs` list in
  `package.json` lets the toggle warn about dependants. Plugins marked non-optional
  (database, auth, api, …) aren't toggleable. Disabling never deletes data (PLAN.md:
  removal only after a backup, never automatic).
- This lives in `plugins/settings` (`settings.overview()` plus a console entry), so no new
  plugin and no new ownership entry.

## The "browser" is the per-page picker

Each domain page already has the picker: pick a provider of that kind, fill its form.
Keep that as the way to browse. Empty states say what's available ("No indexers yet. Add
Torznab…"). The overview gives the cross-cutting view. If user installs are ever built,
new packages would simply appear in these same pickers, so this design doesn't block them
and doesn't depend on them.

## Lifecycle (existing mechanisms only)

| Action              | How                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Add instance        | existing `settings.add`, unchanged                                                          |
| Edit / disable      | existing `settings.update`, unchanged                                                       |
| Remove instance     | existing `settings.remove`, unchanged                                                       |
| Toggle feature      | set or clear `disabled` on its loader entry; refuse if an enabled plugin's `needs` lists it |
| Failed load at boot | entry stays in `magpie.yml`, shown as **Failed** with the error; Magpie still starts        |

## Phasing

1. **Declare kinds.** Add `magpie.hosts` to the six domain plugins, derive kinds in
   `settings`, make `ProviderKind` a string. Pure refactor; pages and behavior unchanged.
2. **`magpie.settings` with `mode`.** Accept it alongside `magpie.provider`, add the
   `single` mode. Migrate no existing plugin.
3. **Overview page.** `settings.overview()` read-only list with links to domain pages and
   failed-state reporting into health.
4. **Feature toggles** with optional `magpie.needs`.

## Testing

With `packages/testing`:

- Kinds come from `hosts` declarations; a provider whose kind has no host is not offered.
- `magpie.provider` and the equivalent `magpie.settings` block produce identical forms.
- `single` mode edits in place, rejects a second entry, masks secrets, and validates.
- `overview()` reports correct state and instance counts; a plugin that throws on load is
  _Failed_ while the rest start.
- `setFeature` toggles an entry and refuses while a dependant is enabled.

## Deferred: user installs

Not part of this work; it would need its own proposal. What makes it separate: getting
packages onto disk and a second discovery location (`settings` is hard-wired to workspace
`plugins/*` siblings); third-party plugins would need compiled JS (built-ins export `.ts`);
console pages are built at Magpie build time; in-process third-party code needs a trust
model; ESM can't unload code and Magpie has no self-restart. PLAN.md reserves
`<config>/plugins/` for it.

## Open questions

1. Should `hosts` also carry the page route, so the overview can link without a lookup?
   (Proposed: yes, `route`.)
2. Which non-provider plugins, if any, are worth moving to `single`-mode forms? None are
   required by this proposal.
3. Keep `magpie.provider` as an alias forever, or deprecate it once `settings` exists
   everywhere?
