# Users, roles and access

How `@magpiejs/auth` decides who may do what. Phase 3's single login ([phase-3.md](phase-3.md) §4.5)
became several users with roles; identity providers (OIDC, trusted-header) are the next step and
will register into this core.

## Roles

A user has one role. Roles are fixed in code (`plugins/auth/src/permissions.ts`) and the user row
stores only the name, so adding a role needs no migration.

| Role      | May                                                                                  |
| --------- | ------------------------------------------------------------------------------------ |
| `admin`   | everything: settings, backups, system, users and API keys                            |
| `manager` | add, change, search and remove media; work the download queue. No settings or system |
| `viewer`  | library, calendar, queue and history, read-only; their own password and sessions     |

Under the roles are permissions, which is what plugins name: `account.self`, `library.read`,
`library.write`, `downloads.manage`, `settings.manage`, `system.admin`, `users.manage`
(`Permission` in `@magpiejs/types`). `auth.can(identity, permission)` is the one check. An unknown
role holds nothing.

Rules kept by the service: the last active administrator can't be demoted, switched off or deleted;
nobody deletes their own account; switching a user off, deleting them, resetting their password or
ending a session also closes that session's open console sockets.

## Who is calling

- **Session**: the `magpie_session` cookie from the login page. Used by the console and its WebSocket.
- **API key**: `X-Api-Key` (or `?apikey=`), only under `/api/`. A key is a `viewer` or a `manager`,
  never an `admin`, and never outranks the user who made it. Keys made before roles existed have no
  owner and became `manager` keys.

The first account, made on the login page at first start, is an administrator. Accounts that
existed before roles became administrators too (migration `0001_roles`).

## Declaring what a route or console action needs

**API routes** (`ctx.api`): `GET` needs `library.read` and every other method `library.write`.
Anything else says so:

```ts
ctx.api.as('settings.manage').put('/subtitles/tools', handler)
ctx.api.get('/backups', handler, { permission: 'system.admin' })
```

**Console entries** (`ctx.webui.addEntry`): the entry's data and methods are reachable over the
console WebSocket, so each entry declares `access`:

```ts
ctx.webui.addEntry(
  {
    // …baseUrl, source, manifest, routes
    access: {
      view: 'library.read', // who is sent the entry's data and page
      call: 'library.write', // who may call its methods (default: view)
      methods: { episodes: 'library.read' }, // exceptions
    },
  },
  data,
)
```

**An entry that declares nothing is for administrators only**, so a new plugin cannot expose itself
by forgetting. `MagpieWebUI` does the filtering: it sends a client only the entries (and later
changes to them) its caller may view, and refuses RPC calls the caller may not make. Entry data is
the same for every browser, so anything about the caller or about other users must come from a
method; read `ctx.webui.caller()` before the method's first `await` to learn who called.

**Pages** can also pass `permission` to `registerPage` to hide themselves from people who lack it.
That is only politeness for entries that mix pages: the server has already refused the calls.

## Configuration

| Setting       | Default | Meaning                                                                                                                                               |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionDays` | 30      | Days a login lasts without use                                                                                                                        |
| `trustProxy`  | `false` | Believe `X-Forwarded-For` / `-Proto`. Turn on behind a reverse proxy, so login limits count real addresses and cookies are marked `Secure` over https |

Failed logins are limited per address and per username (10 in 15 minutes each).

## Known gaps

- Entries that mix library pages with a settings page (downloads, subtitles, decision) are sent to
  everyone who can view the library part, and their settings methods are refused per method. Splitting
  those entries would keep the settings data from viewers too.
- Identity is still local passwords only. Next: split identity into provider plugins
  (`auth-local`, `auth-oidc`, `auth-proxy`) that map an outside identity to a user and role.
