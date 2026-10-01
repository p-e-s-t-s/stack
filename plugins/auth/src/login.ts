// The login page: plain HTML, so it works before the web console loads. Each identity
// provider supplies a section (a form, or a link that starts its login); this is the frame.

import { escapeHtml } from './web'

export function loginPage(options: {
  title: string
  /** The page's own message under the title, e.g. why this is the first-start page. */
  intro?: string
  error?: string
  /** HTML from the providers. */
  sections: string[]
}) {
  const { title, intro, error, sections } = options
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Magpie</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --fg: #1d2129; --muted: #6b7280; --line: #d9dde3; --accent: #3867d6; --on-accent: #fff; --error: #c0392b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181d; --card: #1f2229; --fg: #e6e8eb; --muted: #9aa1ac; --line: #343944; --accent: #6b8ff0; --on-accent: #0c1424; --error: #ef6b5b; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; padding: 16px; }
  main { width: 100%; max-width: 340px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 28px; display: grid; gap: 14px; }
  form { display: grid; gap: 14px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0; color: var(--muted); font-size: 14px; }
  label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
  input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--fg); }
  button, a.button { font: inherit; padding: 9px; border: 0; border-radius: 6px; background: var(--accent); color: var(--on-accent); cursor: pointer; text-align: center; text-decoration: none; display: block; }
  a.button.secondary { background: transparent; color: var(--fg); border: 1px solid var(--line); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 2px 0; width: 100%; }
  .error { color: var(--error); }
</style>
</head>
<body>
<main>
  <div>
    <h1>${escapeHtml(title)}</h1>
    ${intro ? `<p>${escapeHtml(intro)}</p>` : ''}
  </div>
  ${sections.join('\n  <hr>\n  ')}
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
</main>
</body>
</html>`
}
