# Users, roles and access

How `@magpiejs/auth` decides who may do what. Phase 3's single login ([phase-3.md](phase-3.md) §4.5)
became several users with roles, and how people prove who they are moved into identity-provider
plugins that register with the core.

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

- **Session**: the `magpie_session` cookie, started by any identity provider's login. Used by the
  console and its WebSocket.
- **API key**: `X-Api-Key` (or `?apikey=`), only under `/api/`. A key is a `viewer` or a `manager`,
  never an `admin`, and never outranks the user who made it.

## Identity providers

`@magpiejs/auth` owns users, roles, sessions and API keys. It does not check passwords or talk to
login services: **identity providers** are separate plugins that do, and register with
`ctx.auth.providers` (`IdentityProvider` in `plugins/auth/src/providers.ts`). Several can be loaded
at once; the login page shows a section from each.

| Plugin                 | How people prove who they are                                       | Own tables                            |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| `@magpiejs/auth-local` | a username and password; makes the first account                    | `authlocal_credentials`               |
| `@magpiejs/auth-oidc`  | an OpenID Connect provider (Authelia, Authentik, Keycloak, Google…) | none (links are in `auth_identities`) |
| `@magpiejs/auth-proxy` | a header set by a reverse proxy that already logged them in         | none                                  |

A provider can contribute: `login(view)` (HTML for the login page), `setup(view)` (HTML that makes
the first user, shown while there are none), `authenticate(req)` (sign in a request that carries its
own proof, like a proxy header), `password` (so the account and Users pages can set and change
passwords) and `knows(userId)` (shown under "Signs in with"). A provider that learns who someone is
from outside hands auth an `ExternalLogin`, and `auth.resolveExternal()` returns the user:

- A user already linked to that provider's `subject` is found (`auth_identities`).
- Otherwise `matchUsername` signs in as the existing user with that name, and `create` makes a
  new one with the given role. **A matching name alone never gives anyone an existing user**: the
  stranger becomes `amy-2`. `matchUsername` is off by default and only for providers whose names
  can be trusted. A user already tied to a different identity at that provider is not handed over.
- `role` sets the user's role on every login, so the provider decides it. The last active
  administrator is never demoted.

Providers that map groups to roles share `adminGroups`, `managerGroups` and `defaultRole`
(`plugins/auth/src/mapping.ts`): the highest role a person's groups earn, else the default.
`defaultRole: none` lets in only people in those groups.

Add `@magpiejs/auth-local` to `magpie.yml` for password login (a new install's default file has it).
Without any provider the login page says no sign-in method is enabled, so keep at least one.

### auth-oidc

Authorization code flow with PKCE. Fill in `issuer`, `clientId` (and `clientSecret` if the provider
has one), register `<Magpie's address>/auth/oidc/callback` with the provider, and set the groups
that map to roles. Its default `defaultRole` is `none`: nobody gets in until you name a group or
choose a role. `groupsClaim` (default `groups`) is read from the ID token, or from userinfo if the
token leaves it out. New users are named from `usernameClaim`, else the email's first part, else the
subject. The issuer must be https (a loopback address is allowed for testing). The ID token comes
straight from the provider's token endpoint over TLS, which OpenID Connect accepts in place of
checking its signature; its issuer, audience, expiry and nonce are checked. Each login attempt's
state works once, only in the browser that started it.

### auth-proxy

Reads `Remote-User` (and `Remote-Groups`, comma separated) set by a proxy such as Authelia or
oauth2-proxy. Anyone who can reach Magpie directly could send those headers, so they are believed
only on connections from `trustedProxies` (addresses or IPv4 ranges). **With none listed nothing is
trusted.** Do not expose Magpie's port in a way that lets people skip the proxy.

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
      data: { clients: 'settings.manage' }, // top-level data keys that need more than `view`
    },
  },
  data,
)
```

**An entry that declares nothing is for administrators only**, so a new plugin cannot expose itself
by forgetting. `MagpieWebUI` does the filtering: it sends a client only the entries its caller may
view, and refuses RPC calls the caller may not make.

**Hiding keys of an entry's data.** `data` names top-level keys that only some callers may receive,
e.g. the download-client list on a page that otherwise shows the queue. A caller without the
permission never gets the key: it is left out of the first snapshot, and every later change to it is
dropped. Console changes are muon mutations whose encoding depends on the previous one, so they
can't be edited in place; the server filters the mutation and re-encodes it separately for each
client (`MagpieEntry` in `plugins/webui/src/index.ts`, `filter.ts`). A hidden key is simply absent
for that browser, so only pages that need it (settings pages) should read it.

**Entry data is the same for every browser**, so anything about the caller or about other users
doesn't belong in it. Per-user data is served by `/api/v1` routes, which are told who is calling
(`ApiRequest.identity`): `GET/PUT /account…` for your own password and sessions (`account.self`,
logged-in sessions only), and `/users`, `/api-keys` for administrators (`users.manage`). Browsers
using the session cookie must send write bodies as `application/json`.

**Pages** can also pass `permission` to `registerPage` to hide themselves from people who lack it.
That is only politeness for entries that mix pages: the server has already refused the calls.

## Configuration

| Setting       | Default | Meaning                                                                                                                                               |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionDays` | 30      | Days a login lasts without use                                                                                                                        |
| `trustProxy`  | `false` | Believe `X-Forwarded-For` / `-Proto`. Turn on behind a reverse proxy, so login limits count real addresses and cookies are marked `Secure` over https |

Failed logins are limited per address and per username (10 in 15 minutes each).

## Upgrading

Migration `0002_identities` removes `auth_users.password_hash`: passwords now live in
`authlocal_credentials`, which starts empty, so passwords from before the split are not carried
over. Add `@magpiejs/auth-local` to an existing `magpie.yml`, clear the old accounts (their rows are
kept, but they have no password) and make the first account again on the login page.

## Known gaps

- Hiding is per top-level key. Data that mixes library and settings values under one key has to be
  split into two keys before it can be hidden.
- An OpenID login can't be linked to an existing user except by `matchUsername`; there is no
  "link this account" step for a logged-in user yet.
- Sessions made by a provider are not tied to it: removing a provider does not end sessions that
  provider started.
