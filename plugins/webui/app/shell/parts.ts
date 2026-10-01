// The built-in parts. Themes replace them through `registerTheme`; until then (and for
// anything a theme does not provide) these render.

import { themed } from '@magpiejs/console-kit/theme'
import DefaultShell from './default-shell.vue'
import DefaultSettingsLayout from './settings-layout.vue'

export { DefaultSettingsLayout }
export const Shell = themed('shell', DefaultShell)
