---
name: run-erp-demo
description: Run, launch, start, serve, or smoke-test the erp-demo Express/Mongoose backend API. Boots the real server against a throwaway in-memory MongoDB (no external Mongo, no .env), seeds a tenant/role/user, and drives login + CRUD over HTTP. Use when asked to run the backend, start the API, hit an endpoint, get a working JWT, or confirm a backend change works against the live server (not just tests).
---

# Run erp-demo (backend API)

`erp-demo` is a Node.js/Express + Mongoose multi-tenant ERP API. It normally
needs a running MongoDB and a `.env`. This skill's **driver** removes both: it
spins up an in-memory MongoDB **replica set** (via the already-installed
`mongodb-memory-server`), seeds one tenant + an `OVERSEER` role + a user, then
launches the **actual** `src/server.js` against that DB and exercises it over
HTTP with `fetch`.

**All paths below are relative to the unit root (`c:\Muuta\erp-demo`).** The
driver lives at [.claude/skills/run-erp-demo/driver.mjs](driver.mjs).

## Prerequisites

Node 22 (has global `fetch`). Deps are already vendored in `node_modules`; if a
clean checkout, install first:

```sh
npm install
```

No MongoDB install, no `.env`, no `npm run init` needed — the driver owns the
whole DB lifecycle. First run may pause ~10s the very first time
`mongodb-memory-server` downloads its `mongod` binary (then it's cached).

## Run — smoke test (agent path, START HERE)

One command boots the real server on port 3020 and runs
login → list products → create a product → list again, then tears everything
down and exits `0` (pass) / `1` (fail):

```sh
node .claude/skills/run-erp-demo/driver.mjs
```

Expected tail of output:

```
[driver] server is up at http://localhost:3020
[driver] POST /login  -> 200, got JWT (eyJhbGciOiJIUzI1NiIs...)
[driver] GET  /product -> 200, 0 product(s)
[driver] POST /product -> 201, created "Driver Widget"
[driver] GET  /product -> 200, 1 product(s) after create

[driver] SMOKE PASSED
```

To point at a different port: `DRIVER_PORT=3030 node .claude/skills/run-erp-demo/driver.mjs`.

## Run — interactive server (keep it up, poke it yourself)

`--serve` does the same seed + launch + smoke, then **stays up** and prints a
base URL, the login credentials, and a ready-to-use JWT (bound to the OVERSEER
role with every permission). Blocks until Ctrl-C:

```sh
node .claude/skills/run-erp-demo/driver.mjs --serve
```

It prints, e.g.:

```
[driver]   Base URL : http://localhost:3020
[driver]   Swagger  : http://localhost:3020/api-docs
[driver]   Login    : mock-user-1 / Mock-Password123!-1
[driver]   JWT      : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Then, from another shell, drive it with `curl` (grab `$JWT` from that output):

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3020/api-docs/
curl -s -H "Authorization: Bearer $JWT" http://localhost:3020/product
```

Protected routes (`/user`, `/product`, `/stock`, `/customer`, `/purchase-order`,
`/sale-order`, `/tenant`, `/role`, `/asset/*`) all need the `Authorization: Bearer`
header. Only `/login` and `/api-docs` are public. Full API surface: see
[README.md](../../../README.md) or the live Swagger UI at `/api-docs`.

## Run — human path (real Mongo, not headless-friendly)

`npm start` runs `src/server.js` against whatever `.env`/MongoDB you've
configured (default `mongodb://localhost:27017/erp-demo`), and needs the DB
seeded via `npm run init` (which is under refactoring). Without a local Mongo it
logs `Connection ... failed` and exits 1. Prefer the driver above — it needs
neither.

## Test

Vitest + Supertest integration tests against their own in-memory Mongo (serial):

```sh
npx vitest run tests/integration/modules/product/product.test.js
```

Full suite: `npm test`.

## Gotchas

- **The server never reads `req.user.tenant` from seeded data via HTTP; it comes
  from the JWT + a live DB lookup.** The driver seeds through the same Mongoose
  models the app uses (`createMockTenant/Role/User` from
  [tests/setup/mockData.js](../../../tests/setup/mockData.js)) so the tenant is
  `active` and the user's role resolves — otherwise `/login` 200s but every
  protected call 403s ("No active tenant found.").
- **`GET /product` returns a bare array**, not `{ data: [...] }`. The driver
  tolerates both (`body.data ?? body`); don't assume a wrapper.
- **The seeded role is named `test-role` with `role: "OVERSEER"`** and carries
  every module permission (see `initRoleData`). A brand-new permission module
  won't be in that JWT unless it's added to `RoleSchema.rolePermission` **and**
  `initRoleData` — Mongoose strict mode silently strips unknown module keys,
  giving a surprise 403 at the module check.
- **The driver seeds with its own Mongoose connection, then spawns the server as
  a separate `node` child process** pointed at the same in-memory URI via
  `DATABASE_URI`. Both talk to the same `mongod`, so the child sees the seed
  data. It also injects a throwaway `JWT_SECRET_KEY` so sign/verify agree inside
  that child regardless of your `.env`.
- **You'll see `[dotenv] injecting env` twice** — once for the driver, once for
  the child server. Harmless; the driver's explicit env vars win over `.env`.

## Troubleshooting

- `Server did not become ready within 30000ms` — the child server crashed before
  listening. Scroll up for its stack trace (it inherits stdio). Usual cause: a
  port already in use — set `DRIVER_PORT` to a free port.
- First run hangs ~10–30s with no output — `mongodb-memory-server` is
  downloading `mongod`. Let it finish once; subsequent runs are fast.
- `EADDRINUSE` on 3020 — a previous `--serve` run is still up. Kill it, or use a
  different `DRIVER_PORT`.
