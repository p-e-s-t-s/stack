// The login page: plain HTML and a form, so it works before the web console loads.

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

export function loginPage(options: { setup: boolean; next: string; error?: string }) {
  const { setup, next, error } = options
  const title = setup ? 'Create your account' : 'Log in'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Magpie</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --fg: #1d2129; --muted: #6b7280; --line: #d9dde3; --accent: #3867d6; --on-accent: #fff; --error: #c0392b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181d; --card: #1f2229; --fg: #e6e8eb; --muted: #9aa1ac; --line: #343944; --accent: #6b8ff0; --on-accent: #0c1424; --error: #ef6b5b; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; padding: 16px; }
  form { width: 100%; max-width: 340px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 28px; display: grid; gap: 14px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0; color: var(--muted); font-size: 14px; }
  label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
  input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--fg); }
  button { font: inherit; padding: 9px; border: 0; border-radius: 6px; background: var(--accent); color: var(--on-accent); cursor: pointer; }
  .error { color: var(--error); }
</style>
</head>
<body>
<form method="post" action="${setup ? '/auth/setup' : '/auth/login'}">
  <div>
    <h1>${title}</h1>
    ${setup ? '<p>This is the first start. Choose the login for this Magpie.</p>' : ''}
  </div>
  <label>Username <input name="username" autocomplete="username" required autofocus></label>
  <label>Password <input name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required${setup ? ' minlength="8"' : ''}></label>
  ${setup ? '<label>Repeat password <input name="confirm" type="password" autocomplete="new-password" required minlength="8"></label>' : ''}
  <input type="hidden" name="next" value="${escape(next)}">
  ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
  <button type="submit">${setup ? 'Create account' : 'Log in'}</button>
</form>
</body>
</html>`
}
