# Themes — swappable shells, layouts and styles

Not a numbered phase. Plan for letting the web console be re-skinned, and re-laid-out, by
plugins, with each user choosing their own. Builds on [ui-cleanup.md](ui-cleanup.md) (the
`console-kit` list/detail/add components), which is the prerequisite for most of this.

## 1. Goals and non-goals

Goals:

- A theme can change **everything visual**: tokens and fonts, the whole app shell (sidebar,
  top bar, dock…), page-level layouts (library list, detail, add flow, settings frame) and
  where things sit.
- Themes are **partial**. A theme provides only the parts it cares about and inherits the
  rest from its parent (the built-in default unless it says otherwise).
- **Each user picks their own** theme; the instance has a default for users who have not
  chosen. A theme change applies live, without a reload.
- Themes are ordinary plugins registering with a `theme` **service**, the same way indexers
  or health checks register with theirs.
- Kind plugins (movies, series, music…) **know nothing about themes**. They supply data,
  wiring and business logic; they never import a theme.

Non-goals (for now):

- Per-theme user options (density, accent colour pickers). Possible later; the model leaves
  room for it (§4.4).
- Themes that change behaviour, add routes or add data. A theme restyles and rearranges what
  exists; a feature is a plugin.
- Per-page overrides (`movies.list` only). Designed in §5.3, built last.
- Role-based permissions. Magpie has no roles yet, so any logged-in user may change the
  instance default (§4.3).

## 2. What's there today

- `plugins/webui` registers one client slot, `root` (`ctx.client.router.slot({ type: 'root',
component: Root })`). `root.vue` draws the nav, the settings frame, the offline banner, the
  mobile drawer (focus trap, Escape, `inert`) and renders the matched route.
- Navigation comes from page metadata (`registerPage` in `console-kit/client/navigation.ts`,
  `group`/`icon`/`default`/`aliases`) turned into groups by `webui/app/shell/navigation.ts`
  (`navigation()`, `activePage()`; has tests).
- Colours are `--mp-*` custom properties with a dark-mode override and a `.mp-*` class
  vocabulary, all in `webui/app/shell/style.css`. Kind plugins add their own `client/style.css`
  (imported from `client/index.ts`).
- Server side, plugins reach the console with `ctx.webui.addEntry({ source, manifest, routes },
data)`. `data` is **shared by every connected client**, so it cannot carry per-user state.
- Users exist (`auth` plugin: `auth_users`, cookie sessions, `/auth/status`), with no roles.
- `scripts/build-webui.ts` builds every `plugins/*/client/index.ts`, so a theme plugin with a
  `client/` folder is built for free.

## 3. Shape

```
                        ┌──────────────────────────────┐
  server                │ ctx.theme  (@magpiejs/themes) │  registry, instance default,
                        │  register / list / resolve    │  per-user preference, REST
                        └──────────────┬───────────────┘
                                       │ metadata + /themes routes
  client                ┌──────────────▼───────────────┐
                        │  router.views slots + chain   │  chain: user pref → extends… → default
                        │  parts + styles, per theme    │
                        └───┬──────────────┬────────────┘
                 <themed name="…">     tokens / CSS layer
                            │
        shell · settings-layout · media-list · media-detail · media-add · home
                            ▲
              kind plugins render these through console-kit, never a theme directly
```

Three layers, dependencies pointing down only: **kind plugin → console-kit → theme**. A theme
may import console-kit's contract (types, composables); console-kit never imports a theme.

### 3.1 Where the default theme lives

The default theme is **built into `webui`** (today's `root.vue`, `style.css` and the
console-kit components), not a separate plugin. It is the guaranteed fallback: if it were a
plugin, disabling it would leave a blank page. Non-default themes are plugins named
`theme-<name>`, each a thin package with a `client/` entry. (An earlier idea was a
`theme-default` plugin; rejected for this reason.)

## 4. Design

### 4.1 Theme parts (the contract)

A **part** is a named, replaceable component with a fixed props/slots contract. v1 list,
deliberately short because it becomes public API:

| Part              | Replaces                                          | Receives                                          |
| ----------------- | ------------------------------------------------- | ------------------------------------------------- |
| `shell`           | `root.vue`: nav, header, drawer, routed page area | `useNavigation()`, default slot = the routed page |
| `settings-layout` | settings heading + settings nav + page frame      | `useNavigation()`, default slot                   |
| `home`            | `home.vue`                                        | —                                                 |
| `media-list`      | `MediaCardGrid` (library lists)                   | same props/slots `MediaCardGrid` has today        |
| `media-detail`    | `MediaDetailShell`                                | same props/slots `MediaDetailShell` has today     |
| `media-add`       | `AddMediaFlow` (search → pick → configure → add)  | same props/slots `AddMediaFlow` has today         |

Rules for parts:

- A part's props/slots are the console-kit component's existing ones. Kind plugins already
  pass them; the contract is "what `MediaCardGrid` takes", not a new design.
- A part must keep the `data-testid`s and ARIA landmarks the default has (`#mp-main`, skip
  link, `aria-current`). Shared helpers (§4.2) make this easy; the part list in code carries
  a short "must preserve" note per part.
- The contract is versioned: `theme.apiVersion` (integer). Registering a theme with a newer
  version than the engine knows is refused with a clear error; an older one still works until
  support is dropped.

### 4.2 Composables a theme builds on

Exported from `console-kit` (the navigation model moves there from `webui/app/shell`, tests
with it):

- `useNavigation()`: `{ groups, settings, active, landing, destination, inSettings, href(page),
navigate(event, path) }`. Themes draw navigation; they do not compute it.
- `useDrawer()`: the open/close, focus-trap and Escape logic currently inline in `root.vue`,
  so a custom shell gets the same accessibility without copying it.
- `useConnection()`: `{ ready, connected }` for an offline banner.

### 4.3 Server: the `theme` service (`@magpiejs/themes`)

New plugin, `Service` subclass like `AuthService`. Injects `database`, `server`, optionally
`auth` and `webui`.

```ts
interface ThemeDefinition {
  id: string // 'compact', unique
  name: string
  description?: string
  extends?: string // parent theme id; defaults to 'default'
  apiVersion: number
  provides: ThemePart[] // for the Appearance page; the client bundle is authoritative
  swatch?: string[] // a few CSS colours for the picker card
}

ctx.theme.register(def): Dispose     // for the caller's lifetime, like ctx.health.check
ctx.theme.list(): ThemeDefinition[]  // includes the built-in 'default'
ctx.theme.defaultId(): string
ctx.theme.setDefault(id): void
ctx.theme.preference(userId): string | null
ctx.theme.setPreference(userId, id | null): void
ctx.theme.resolve(userId): string[]  // chain, most specific first, always ends in 'default'
```

- A theme plugin calls `ctx.theme.register(...)` and `ctx.webui.addEntry(...)` for its client
  bundle. Disposing the plugin removes both.
- State in the database (namespace `themes`, via `database.register` with migrations, like
  `auth`): `themes_settings` (`default_theme`) and `themes_preferences` (`user_id` →
  `theme_id`, cascade on user delete). Unknown or uninstalled ids are never an error to the
  reader: `resolve` skips them and falls back.
- Per-user state cannot ride on `addEntry` data (shared by all clients), so the client reads
  its own choice over HTTP with the session cookie, like `/auth/status`:
  - `GET /themes` → `{ themes, default, mine, chain }`
  - `PUT /themes/me` `{ id: string | null }` (null = follow the default)
  - `PUT /themes/default` `{ id }`; **any** logged-in user for now, since there are no roles.
- Cycles in `extends` are cut at registration (a theme whose chain loops is refused).
- Event `theme/changed` fires on register/dispose/default change; the console refetches.

### 4.4 Client: slots, not a custom registry

`@cordisjs/client` (0.8.2, read from source) already has the mechanism, so themes use it
instead of a registry of our own:

- `ctx.client.router.slot({ type, component, order, disabled })` registers a component for a
  named slot. The slot list is `ctx.client.router.views`, **a service on the client's root
  context**, so every plugin entry reaches the same list through its own `ctx` however many
  copies of a module are bundled (§4.6).
- `<k-slot name="x" single>` renders the enabled item with the highest `order`, passing its
  `data` as props and its slots through, or its own default content when nothing is
  registered. `disabled` is a function read at render time, so it can depend on reactive
  state.
- The client also ships `ctx.client.theme.theme({ id, components })`, which is this idea but
  keyed on a dark/light preference kept in client settings. It cannot express a per-user
  server-side choice or inheritance, so Magpie registers slots directly and does not use it.

A **part** is a slot type (`media-list`, `shell`, …). A theme registers its parts like this,
in its client entry:

```ts
// plugins/theme-tv/client/index.ts
import { registerTheme } from '@magpiejs/console-kit/theme'
import Shell from './Shell.vue'
import MediaList from './MediaList.vue'
import './tokens.css?inline'

export default function (ctx: Context) {
  registerTheme(ctx, { id: 'tv', parts: { shell: Shell, 'media-list': MediaList } })
}
```

`registerTheme` is a small helper in console-kit. For each part it calls `router.slot` with:

- `disabled: () => !chain.value.includes(id)`, where `chain` is the current user's resolved
  chain (`['tv', 'default']`) from `GET /themes`;
- `order`: the theme's position in the chain, so the most specific theme wins under `single`.

That is the whole of partial themes and `extends`: a part the theme does not register simply
falls through to the next theme in the chain, and the default's components are registered
by `webui` at the lowest order. Changing the preference changes `chain`, and the console
re-renders with no reload.

**Kind plugins do not change.** console-kit's `MediaCardGrid`, `MediaDetailShell` and
`AddMediaFlow` become thin wrappers around their current implementations. The wrapper is the
`<themed>` shorthand used elsewhere in this doc:

```ts
// console-kit/src/themed.ts (sketch)
export function themed(name: string, Default: Component) {
  return defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      const ctx = useContext()
      return () => {
        const part = [...(ctx.client.router.views[name] ?? [])]
          .filter((item) => !item.disabled?.())
          .sort((a, b) => b.order! - a.order!)[0]
        return h(part?.component ?? Default, attrs, slots)
      }
    },
  })
}
// MediaCardGrid.vue's exported component = themed('media-list', DefaultMediaCardGrid)
```

`movie-list.vue` keeps importing `MediaCardGrid` and passing the same props and slots; if a
theme registered `media-list`, that is what renders, with the same props and slots. (The
helper resolves the slot itself rather than using `<k-slot>`, because `<k-slot>` forwards
only its own slots to the chosen component, which would drop the `#meta`/`#actions` slots the
kind plugins pass.)

- **Styles** (§4.5) follow the same chain, base first, so a child's tokens override its
  parent's.
- **Lazy loading.** A part may be given as `() => import('./Shell.vue')`; the helper wraps it
  in `defineAsyncComponent`, so a theme's heavy parts load only when its chain is active. A
  part that fails to load falls through to the next in the chain, so one broken theme cannot
  blank the console.
- **First paint.** The shell must know the chain before it renders, or the user sees the
  default flash. The client mirrors the server-resolved chain in `localStorage`, uses it
  immediately, and corrects it when `GET /themes` answers (e.g. changed on another device).
- **Theme options** (future): see §5.5.

### 4.5 Styles and CSS ordering

Tokens alone are not enough: kind plugins ship their own `client/style.css`, and unlayered
rules always beat layered ones, so a theme could not override them. Fix it once, up front:

- Declare the order `@layer base, kind, theme;` at the top of the shell stylesheet.
- Wrap `webui/app/shell/style.css` in `base`, every plugin `client/style.css` in `kind`, and
  inject theme CSS inside `theme`.
- A theme's CSS is injected as a single `<style data-theme="id">` on activation and removed
  on deactivation (one per chain member, base first). Nothing in a theme leaks when inactive.
- `data-theme` and `data-theme-chain` attributes on `<html>` let CSS target a theme.

This is a mechanical but wide edit (every `style.css`); it ships first (§6 step 1) with no
visible change.

### 4.6 Where shared state lives (and why `console-kit` is not a vendor chunk)

An earlier draft proposed making `console-kit` a shared vendor chunk so a registry singleton
would be one instance. That was the wrong fix. In Cordis, state lives in **services reached
through the context**, not in module-level variables, so the number of bundled copies of a
module does not matter. The slot list is `ctx.client.router.views`; the server side is
`ctx.theme`. Neither is a module singleton.

`vue` and `@cordisjs/client` are vendor chunks in `webui/app/vite.config.ts` for a different
reason: they keep module-level state (Vue's current-instance tracking, the `kContext`
injection key in `@cordisjs/client`), and two copies break at runtime. `console-kit`
holds only stateless components and helpers that take `ctx` as an argument, so duplication
costs bytes, not correctness. The rule for this work is: **nothing in `console-kit` keeps
state in module scope; state goes in a service or in `ctx`-keyed data**.

## 5. Behaviour details

### 5.1 Partial themes and `extends`

`extends` defaults to `default`. A theme may extend another installed theme (a "compact"
variant of "tv-wall"). If the parent is not installed, the theme is shown as unavailable on
the Appearance page and the user falls back to the default (no error).

### 5.2 The Appearance page

`Settings → Appearance`, registered by the themes plugin (a normal `registerPage` under
`configuration`):

- Cards for each theme: name, description, swatch, which parts it replaces.
- **Use for me** / **Follow instance default**, and **Use as instance default**.
- Preview-on-hover is out of scope; applying is instant and reversible.

### 5.3 Per-page overrides (last)

Part lookup tries a scoped name first: `media-list:movies`, then `media-list`. Kind plugins
pass a `scope` to `<themed>`. A theme may then restyle only the movies list. Not needed for
v1; the resolver reserves the syntax so adding it changes no existing theme.

### 5.4 Failure and edge cases

| Case                                     | Behaviour                                               |
| ---------------------------------------- | ------------------------------------------------------- |
| Preferred theme uninstalled              | Chain skips it; default (or instance default) is used   |
| Theme part fails to load                 | Logged; falls through to parent, then default           |
| Theme `apiVersion` newer than the engine | Refused at registration; not listed as usable           |
| `extends` loop                           | Refused at registration                                 |
| Not logged in (login page)               | Login is server-rendered and not themed in v1           |
| Instance default theme uninstalled       | Reverts to `default`; stored id kept in case it returns |

### 5.5 Variants as plugin instances, and theme options

Cordis can load the same plugin several times with different configs, and nested config is
how a plugin is parameterised. Magpie already uses the pattern for providers (`settings`:
entries of a provider with a config). Themes can use it too, so a variant need not be a new
package:

- A theme plugin takes a `Config` schema (`accent`, `density`, `fontScale`…) and a `name`,
  and registers a theme from it. Loading `theme-base` twice, as "Comfortable" and "Compact",
  gives two selectable themes from one codebase.
- An admin sets those options in the plugin's Cordis config (where Magpie config is edited
  today). Per-**user** options stay a non-goal for v1; if wanted later they become a small
  schema stored next to the preference.
- The theme's id comes from its config, so each instance registers with `ctx.theme.register`
  independently and disposes with its own scope.

## 6. Steps

Each step ends with the app running and tests green, and no step changes what the default
user sees until step 3.

0. **Spike (no merged code).** Confirm in the running app: (a) whether every `addEntry`
   entry loads for every page or only for its `routes`; (b) that a slot registered from one
   entry is seen by `ctx.client.router.views` in another; (c) that `root` can be overridden
   with `order`/`disabled` (the engine's `root` slot is order -1000, so a theme's root needs a
   higher order and the default must stay as the fallback); (d) first-paint behaviour with the
   `localStorage` mirror.
1. **CSS layers.** `@layer base, kind, theme`; wrap all stylesheets. No visual change.
2. **Contract extraction.** Move the navigation model and its tests to `console-kit`; add
   `useNavigation`, `useDrawer`, `useConnection`; rebuild `root.vue` on them.
3. **`registerTheme` and `themed`.** The chain-to-`disabled`/`order` helper, lazy parts,
   failure fall-through (the chain logic as a pure function, unit-tested with vitest). The
   shell's `root` slot resolves through `themed('shell', …)`; the `console-kit` list, detail
   and add components become `themed(...)` wrappers. Default parts are the existing
   components, so kind plugins are untouched.
4. **Server `theme` service.** `@magpiejs/themes`: service, schema + migration, REST, events,
   tests (register/dispose, chain with unknown ids, cycle refusal, preference cascade on user
   delete, default fallback).
5. **Appearance page and per-user selection**, including the `localStorage` mirror.
6. **Proof themes.** One partial theme (tokens + fonts only, to prove inheritance) and one
   deliberately different full theme (top-nav `shell`, table `media-list`) to stress the
   contract. Fix the contract, not the themes, when something is awkward.
7. **Author docs** (`docs/theme-authoring.md`): parts table, composables, "must preserve" list,
   a minimal theme skeleton.
8. **Later:** per-page overrides (§5.3), theme options, login-page theming.

## 7. Risks and open questions

- **Public API surface.** Part names and props become a promise once third parties write
  themes. Keep the list short, version it, and prefer adding parts to changing them.
- **Accessibility regression** in custom shells. Mitigated by `useDrawer`/`useNavigation` and
  the "must preserve" notes, not enforceable by code.
- **Bundle size.** Lazy parts/styles (§4.4) keep inactive themes off the wire; verify against
  the build output in step 6.
- **Instance default needs an admin concept.** Until roles exist, any user can change it.
  Decide whether that is acceptable or whether the first user is treated as admin.
- **Module-level state in `console-kit`** would silently split across entries (§4.6). Keep
  it stateless; a lint rule or review note is enough.
- **Login page** is server-rendered (`auth/src/login.ts`) and outside the theme system; it
  will look un-themed until it gets a token-only treatment.
