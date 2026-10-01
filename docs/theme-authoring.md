# Writing a theme

A theme is a plugin named `theme-<name>`: a few lines on the server to register it, and a
console entry that ships its CSS and components. Two complete examples live in
`plugins/theme-slate` (colours and type only) and `plugins/theme-dock` (a different shell and
library list, built on Slate). Design and background: [themes.md](themes.md).

## The server half

```ts
// src/index.ts
export const name = 'theme-slate'
export const inject = ['theme', 'webui']

export function apply(ctx: Context) {
  ctx.theme.register({
    id: 'slate', // lowercase letters, digits, dashes
    name: 'Slate',
    description: '…',
    extends: 'other-theme', // optional; the built-in default when omitted
    apiVersion: 1,
    swatch: ['#eef2f4', '#ffffff', '#0f766e'], // optional, for the Appearance page
  })
  ctx.webui.addEntry({
    baseUrl: import.meta.url,
    source: '../client/index.ts',
    manifest: '../dist/manifest.json',
    routes: [],
  })
}
```

`register` lasts as long as the plugin. It throws for a reserved or duplicate id, a newer
`apiVersion` than Magpie knows, or a loop in `extends`. Add the package to the app's plugin
list (`packages/app/src/index.ts`) and `packages/app/package.json`.

## The client half

```ts
// client/index.ts
import { registerTheme } from '@magpiejs/console-kit/theme'

export default function (ctx) {
  registerTheme(ctx, {
    id: 'slate',
    styles: () => import('./slate.css?inline'),
    parts: { shell: { load: () => import('./shell.vue') } }, // optional
  })
}
```

A theme provides any of: **styles**, **parts**, or both. Whatever it leaves out comes from
the next theme in its `extends` chain, and finally the built-in look. Everything loads lazily,
so a theme costs nothing until someone uses it.

### Styles

CSS is injected inside the `theme` cascade layer, after the built-in (`base`) and plugin
(`kind`) layers, so plain selectors beat them. Override the `--mp-*` custom properties for
colours and `--mp-radius`; add rules for the `.mp-*` classes or your own. Define a dark set in
`@media (prefers-color-scheme: dark)`. Page components' `<style scoped>` blocks are not
layered; they only touch page-specific classes.

### Parts

| Part              | What it draws                               | It receives                               |
| ----------------- | ------------------------------------------- | ----------------------------------------- |
| `shell`           | the page frame                              | nothing; use the helpers below            |
| `settings.layout` | the Settings heading, its nav and the frame | a default slot with the settings page     |
| `media.list`      | a library list (movies, series, …)          | the props and slots of `MediaCardGrid`    |
| `media.detail`    | a detail page header and body               | the props and slots of `MediaDetailShell` |
| `media.add`       | the add flow                                | the props and slots of `AddMediaFlow`     |

`MediaCardGrid`, `MediaDetailShell` and `AddMediaFlow` are in
`packages/console-kit/src/defaults/`; copy the props from there. A part must keep the
`data-testid`s the built-in has (for example `cardTestId` on each list item).

### Building a shell

Import from `@magpiejs/console-kit/theme`:

- `useNavigation()`: `{ model, active, inSettings, href, navigate }`. Draw the nav yourself.
- `<RoutedPage />`: the current page (and the not-found and loading messages).
- `<Part name="settings.layout">`: the settings frame, themed or built-in.
- `<Region name="shell.nav-foot" />`, `shell.notices`, `shell.topbar`: what plugins
  contribute (Settings link, Log out, the offline notice). Place them or leave them out.
- `useDrawer()`, `useBreakpoint()`, `useConnection()`: the built-in mobile drawer with focus
  handling, the mobile/desktop switch, and the connection state.

Keep the skip link and the `id="mp-main"` landmark. Do not register the `root` slot: it is the
engine's.

### Plugins contributing to a region

```ts
import { registerRegion } from '@magpiejs/console-kit/theme'
registerRegion(ctx, 'shell.nav-foot', MyButton, { order: 10 }) // higher order first
```

## Failure and recovery

A part that throws while rendering is dropped and the next theme in the chain (finally the
built-in) renders instead; the error is logged. Open any page with `?theme=default` to see
the built-in look for that tab, and `/settings/appearance` to change your theme.
