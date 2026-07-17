# ERP-demo agents

Project-specific Claude Code subagents for the `erp-demo` backend. Each agent
does **one job**, so it can be reused on its own or composed into a larger
workflow.

## Design philosophy

Every agent here follows the same recipe:

- **Template + placeholders** — generated files come from a checked-in template
  with a small, fixed set of placeholders, so output is predictable rather than
  free-form. The name variants (PascalCase/camelCase, singular/plural, kebab)
  are derived once by a dedicated `api-derive-model-variants` agent and handed
  to the scaffold agents as a JSON object, so each scaffold agent only
  substitutes strings and never re-derives names (one source of truth).
- **Least-privilege tools** — each agent is granted only the tools it needs
  (e.g. a read-only checker gets `Bash` but never `Write`).
- **Non-interactive** — agents act on their input without asking follow-up
  questions, so they slot into automated chains.
- **Verify by running** — correctness is confirmed by actually running the code
  (lint, tests, a live smoke test), not by inspection alone.
- **Copy, don't invent** — every agent that writes a whole file from a template
  carries a `## Rules` block telling it to apply only the placeholder
  substitutions and never invent domain content (fields, values, sample
  records). Without it a weak model will "helpfully" generate realistic data
  from the model name instead of leaving the template's placeholders for the
  developer — measured at ~1/3 of runs before the rule, 0 after. The
  single-line `Edit`-insert agents (`api-create-app-mount`,
  `api-create-rolepermission-entry`) skip the block — one line at a marker has
  almost no invention surface — but `api-create-mock-factory-fn` and
  `api-create-mock-rolepermission`, though also `Edit`-only, insert multi-line
  content and so keep it.

---

## Agents (catalog)

### api-derive-model-variants

- **Model:** sonnet · **Tools:** none
- **Job:** Turn a raw model name into the canonical set of naming variants that
  every other scaffold agent consumes. Produces no files — a pure text
  transformation, so it is granted no tools.
- **Input:** the raw model name, one or more words (e.g. `sale order`). No
  confirmation prompt.
- **Output:** **only** a JSON object (no prose, no code fences), string values:
  `{ "Model": "SaleOrder", "model": "saleOrder", "Models": "SaleOrders", "models": "saleOrders", "model-kebab": "sale-order" }`
- **Why sonnet, not haiku:** pluralization is the one linguistically-hard step
  and it feeds every downstream agent, so it runs on a stronger model. Irregular
  plurals (`mouse` → `mice`) come out correct here, where haiku would not.
- **Why it exists:** the five scaffold agents used to each re-derive these
  variants from the raw name — the same logic duplicated in five places.
  Centralizing it gives one source of truth for casing/plural rules, and lets
  the downstream haiku agents do literal substitution instead of reasoning about
  names.

**Known limitations**

| Limitation | Detail |
|---|---|
| Multi-word names must be reinforced | A non-obvious multi-word name can tempt reinterpretation — an early version turned `cat plan` into `Cat`, dropping a word. `## Input` is now hardened to "treat every word as part of the single model name — never drop, add, or reinterpret a word"; still worth a glance for unusual inputs. |

### api-create-model

- **Model:** haiku · **Tools:** Read, Write, Edit
- **Job:** Scaffold a new Mongoose model file in `src/models/` containing only
  the non-domain boilerplate (schema shell, tenant/audit wiring, CRUD function
  stubs). Domain fields are added by hand afterwards.
- **Input:** the variants JSON from `api-derive-model-variants` (uses keys
  `Model` / `model` / `Models` / `models`). No confirmation prompt.
- **Recipe:**
  - Two templates: `model.template.tmpl` and `modelIndex.template.tmpl`.
  - Substitutes the four variant tokens read from the input JSON — `<Model>` /
    `<model>` and `<Models>` / `<models>` — with no derivation of its own.
  - Writes `src/models/<model>Model.js`, then inserts the re-export into
    `src/models/index.js` above a marker line (the marker stays last).

**Known limitations**

| Limitation | Detail |
|---|---|
| Guard checks the filename, not export names | The pre-write guard only checks whether a model *file* of that name already exists. It does **not** detect export-name collisions in `index.js`. A name whose generated exports clash with an existing model's (e.g. `category` vs the existing `productCategory`) passes the guard but produces duplicate exports that break `index.js`. |

### api-create-module-service

- **Model:** haiku · **Tools:** Read, Write
- **Job:** Scaffold the **service** layer for a module in
  `src/modules/<model>/services/` — the HTTP-agnostic layer that takes `(req)`,
  calls the model CRUD functions, and returns data or throws (never touches
  `res`/`next`).
- **Input:** the variants JSON from `api-derive-model-variants`. No confirmation
  prompt.
- **Recipe:**
  - Two templates: `moduleService.template.tmpl` and
    `moduleServiceIndex.template.tmpl`.
  - The same four variant tokens as `api-create-model`, read from the input JSON.
  - Writes `src/modules/<model>/services/<model>Service.js` and the barrel
    `src/modules/<model>/services/index.js` (which exports a `<model>Service`
    object). **No `Edit`** — the barrel is written whole per module, not
    marker-inserted like the model's `index.js`.

### api-create-module-controller

- **Model:** haiku · **Tools:** Read, Write
- **Job:** Scaffold the **controller** layer in `src/modules/<model>/` — the
  only layer with a `try/catch`, owning HTTP status codes (200/201/400/404) and
  forwarding errors via `next(error)`. Delegates all work to
  `<model>Service.<fn>(req)`.
- **Input:** the variants JSON from `api-derive-model-variants`. No confirmation
  prompt.
- **Recipe:**
  - One template: `moduleController.template.tmpl`.
  - The same four variant tokens as `api-create-model`, read from the input JSON.
  - Writes a single file `src/modules/<model>/<model>Controller.js` — **no
    barrel** (controllers are imported directly by routes). `Read` + `Write`
    only.
  - Fully independent: it does **not** check that the service layer exists. The
    shared placeholder rule guarantees the controller's
    `import { <model>Service } from './services/index.js'` matches the barrel
    that `api-create-module-service` emits, so the layers line up whenever both
    agents run on the same input.

### api-create-module-route

- **Model:** haiku · **Tools:** Read, Write, Edit
- **Job:** Scaffold the **route** layer in `src/routes/` — the endpoint
  definitions that map each HTTP verb to a controller function and guard it with
  `authorizationMiddleware(module, feature)`. Swagger docs are **not** written
  here (a separate, higher-quality-model agent handles those).
- **Input:** the variants JSON from `api-derive-model-variants`. No confirmation
  prompt.
- **Recipe:**
  - Three templates: `moduleRoutes.template.tmpl` (the route file) plus
    `moduleRoutesIndexImport.template.tmpl` and
    `moduleRoutesIndexObject.template.tmpl` (the two lines inserted into the
    aggregator).
  - The same four variant tokens as `api-create-model`, read from the input JSON
    — though only three appear in a route file (`<models>` is unused; the paths
    are `/` and `/:id`).
  - Writes `src/routes/<model>Routes.js`, then `Edit`-inserts an import line and
    an entry into the `routes` object of `src/routes/index.js`, each above its
    own marker line. Unlike the model's single flat marker, the aggregator needs
    **two** markers (the imports and the object are separate regions); each
    inserted object entry carries a **trailing comma** so repeated inserts stay
    syntactically valid.
  - Idempotency guard: refuses if `src/routes/index.js` already references
    `<model>Routes`.
  - Fully independent: it does **not** check that the controller exists. The
    shared placeholder rule guarantees the route's
    `import { read<Models>, … } from '../modules/<model>/<model>Controller.js'`
    matches the controller's exports whenever both agents run on the same input.
- **Out of scope (handled elsewhere):** the role permissions behind the feature
  keys and Swagger docs — separate planned agents. The `app.js` mount is done by
  its own `api-create-app-mount` agent (below).

### api-create-app-mount

- **Model:** haiku · **Tools:** Read, Edit
- **Job:** Mount a module's routes in `src/app.js` so its endpoints become
  reachable. Creates no new file — a single `Edit` insert.
- **Input:** the variants JSON from `api-derive-model-variants` (uses only the
  `model` and `model-kebab` keys). No confirmation prompt.
- **Recipe:**
  - One template: `moduleAppMount.template.tmpl`.
  - `Edit`-inserts `app.use('/<model-kebab>', routes.<model>);` above a marker in
    the **Protected routes** region of `app.js` — below the authentication
    middleware, so the module is not public (order-sensitive: above it would make
    the endpoints public).
  - Uses the 5th variant token `<model-kebab>` (lowercase, spaces → hyphens) so
    multi-word URLs are kebab (`/sale-order`) while the object key stays camel
    (`routes.saleOrder`).
  - Idempotency guard: refuses if `app.js` already references `routes.<model>`.
  - No trailing-comma hazard — each `app.use(...)` is an independent
    `;`-terminated statement (unlike the route agent's object-entry insert).

### api-create-rolepermission-entry

- **Model:** haiku · **Tools:** Read, Edit
- **Job:** Register a new module's key in `RoleSchema.rolePermission` in
  `src/models/roleModel.js`. This single `{ type: Map, of: PermissionSchema }`
  entry is what Mongoose strict mode requires — without it the whole permission
  block for that module is silently stripped on save, and every request to the
  module returns `403`. Like `api-create-model`, it scaffolds only the
  structural slot; the permission **values** are deliberately not its job.
- **Input:** the variants JSON from `api-derive-model-variants` (uses only the
  `model` key). No confirmation prompt.
- **Recipe:**
  - One template: `modelRolepermissionEntry.template.tmpl` —
    `<model>: { type: Map, of: PermissionSchema },` (trailing comma included).
  - `Edit`-inserts it above a marker line inside the `rolePermission` object
    (the marker stays last). The trailing comma keeps repeated inserts valid — a
    trailing comma before the marker comment before the closing `}` is legal JS,
    so the previously-last entry never needs comma surgery.
  - Creates no file — a single `Edit`, so no `Write`.
- **Out of scope:** the permission **values**
  (`access` / `adminTenantOnly` / `immutable`) differ per role and are set
  elsewhere — the seed-data files (`src/scripts/init/data/init*Permissions.json`)
  and the test role in `tests/setup/mockData.js`. This agent only opens the
  schema slot.

**Known limitations**

| Limitation | Detail |
|---|---|
| No idempotency guard | Re-running with the same `model` inserts a duplicate key above the marker. JS keeps the last one (no error), but the entry is untidy — unlike `api-create-module-route` / `api-create-app-mount`, which refuse on re-reference. |

### api-create-seed-rolepermission

- **Model:** haiku · **Tools:** Read, Edit
- **Job:** Write a module's permission **values** into the four production role
  seed files (`src/scripts/init/data/init*Permissions.json`) — the *values* side
  of production-role permissions, mirroring what `api-create-mock-rolepermission`
  does for the test role. Each of the four roles gets the same five CRUD feature
  keys but different booleans (Overseer: `access`/`adminTenantOnly`/`immutable`
  all true; Admin: `access` true, the other two false; Writer: `delete` denied;
  Reader: reads only).
- **Input:** the variants JSON from `api-derive-model-variants` (uses
  `model` / `Model` / `Models`). No confirmation prompt.
- **Recipe:**
  - Four templates — one per role file (`initOverseerPermissionsEntry` …
    `initReaderPermissionsEntry`) — because the booleans differ per role they are
    baked into each template, not derived. Indentation and the trailing comma are
    baked in too.
  - Tokens `<model>` (module key) and `<Model>` / `<Models>` (feature-key casing).
  - `Edit`-inserts each block above the marker **key** in its file — a dedicated
    JSON anchor key (`__api-create-seed-rolepermission_marker__`) kept as the last
    key of each object, so the block lands as the last module (the marker stays
    last). JSON has no comment syntax, so the anchor is a real key rather than a
    comment; `init.js` cherry-picks named modules and never reads it, so it is
    inert in the seeded data.
  - Creates no file — four `Edit`s, so `Read` + `Edit` only (no `Write`).
- **Keeps the `## Rules` block** — it inserts multi-line content with per-role
  booleans, so the no-invent rule matters (only the five template keys, the exact
  baked-in booleans, no item permissions).
- **Out of scope:** the schema slot (`api-create-rolepermission-entry`) and the
  hardcoded init object (`api-create-init-rolepermission`) — this agent only
  writes the values into the JSON.

**Known limitations**

| Limitation | Detail |
|---|---|
| Inconsistent idempotency | No hard re-reference guard. On re-run the model may correctly detect a file that already contains the module and skip it, but it has also been observed to skip files that do *not* yet contain it (a false "already present"), and on another run to re-insert — risking a duplicate key. Run it once per module and verify the diff. |

### api-create-init-rolepermission

- **Model:** haiku · **Tools:** Read, Edit
- **Job:** Register a new module in the **hardcoded `rolePermission` object** in
  `src/scripts/init/init.js`. That object cherry-picks each module by name
  (`product: new Map(Object.entries(rolePermissions.product))`, …) when building
  the `Role` document, so a module absent here is silently dropped from every
  seeded role even when its permission values exist in the JSON files. This is a
  fourth place a new module's permissions must appear, beyond the three listed in
  the backend `CLAUDE.md`. Like `api-create-rolepermission-entry`, it scaffolds
  only the structural slot; the values live in the seed JSON.
- **Input:** the variants JSON from `api-derive-model-variants` (uses only the
  `model` key). No confirmation prompt.
- **Recipe:**
  - One template: `initRolePermissionEntry.template.tmpl` —
    `<model>: new Map(Object.entries(rolePermissions.<model>)),` (trailing comma
    included). Unlike its sibling `modelRolepermissionEntry.template.tmpl`, the
    12-space indentation is baked into the template so the inserted line aligns
    with the object it joins.
  - `Edit`-inserts it above a marker line inside the `rolePermission` object (the
    marker stays last). The trailing comma keeps repeated inserts valid — the
    previously-last entry (`saleOrder`) gets its comma once, when the marker is
    added by hand.
  - Creates no file — a single `Edit`, so `Read` + `Edit` only (no `Write`).
  - No `## Rules` block — a single line at a marker has almost no invention
    surface (same rationale as `api-create-rolepermission-entry`).
- **Out of scope:** the permission **values** — set in the seed JSON files by
  `api-create-seed-rolepermission`. This agent only adds the Map-conversion line.

**Known limitations**

| Limitation | Detail |
|---|---|
| No idempotency guard | Re-running with the same `model` inserts a duplicate line above the marker. JS keeps the last one (no error), but the entry is untidy — like `api-create-rolepermission-entry`. |

### api-create-integration-test

- **Model:** haiku · **Tools:** Read, Write
- **Job:** Scaffold a Vitest + Supertest **integration test** file in
  `tests/integration/modules/<model>/`. Like `api-create-model`, it scaffolds
  only the *structure* — the boilerplate that is identical in every module — and
  leaves the domain-specific parts to be filled in by hand.
- **Input:** the variants JSON from `api-derive-model-variants` (uses only
  `Model` / `model` / `model-kebab`). No confirmation prompt.
- **Scope:** plain CRUD only — four `describe` blocks (`POST`, `GET /:id`,
  `PUT /:id`, `DELETE /:id`), mirroring `customer.test.js`. No list-endpoint
  test and no embedded-item sub-resource tests, matching the "basic CRUD only"
  line the other scaffold agents hold. Consequently only three of the five
  variant tokens appear (`<Models>` / `<models>` are unused).
- **Recipe:**
  - One template: `integrationTest.template.tmpl`.
  - **Verbatim structure** (no placeholders): imports, `createMockData`,
    `beforeAll`/`afterAll`, the `expect(status)` / `expect('_id')` assertions.
  - **Placeholders:** `<Model>` (var names `created<Model>Id`, the
    `'<Model> deleted'` assertion), `<model>` (folder, filename, `<model>Data`),
    `<model-kebab>` (route paths).
  - **Domain data deliberately omitted** — two spots carry a placeholder comment
    instead of fields: the POST body (`<model>Data = { /* domain fields */ }`)
    and the PUT update (`<model>Data = { ...<model>Data, /* updated fields */ }`,
    a spread merge so it parses and runs as-is; the coder adds override keys).
  - Writes `tests/integration/modules/<model>/<model>.test.js`.
  - Idempotency guard: refuses if that test file already exists.

**Known limitations**

| Limitation | Detail |
|---|---|
| Scaffold does not pass until the module exists | The generated test targets `/<model-kebab>` routes. Until the full module is scaffolded **and** mounted **and** permitted, every call returns 404/403, so the suite is red by design — it verifies the *file* is valid JS and correctly substituted, not that the module works. |
| Empty POST body vs required fields | The POST body starts empty (`{}`); the create call expects `201`. If the model has required domain fields, create returns `400` until the coder fills the body — an expected "unfinished" state, not an agent bug. |

### api-create-mock-data

- **Model:** haiku · **Tools:** Read, Write, Edit
- **Job:** Scaffold an empty per-domain mock-data file in `tests/setup/mockData/`
  and register it in that folder's `index.js`. The file is a placeholder the
  developer fills with domain fields — no domain data is generated.
- **Input:** the variants JSON from `api-derive-model-variants` (uses only the
  `model` key — mock-data file names are camelCase, e.g. `saleOrder.js`, so this
  is the only scaffold agent that needs just one of the five variants). No
  confirmation prompt.
- **Recipe:**
  - Three templates: `mockData.template.tmpl` (the file body — two
    `{ /* Developer: … */ }` placeholder objects, with **no** placeholder
    tokens), plus `mockDataIndexImport.template.tmpl` and
    `mockDataIndexObject.template.tmpl` (the two lines inserted into `index.js`).
  - Writes `tests/setup/mockData/<model>.js`, then `Edit`-inserts an import line
    and an export-object entry into `tests/setup/mockData/index.js`, each above
    its own marker — **two** markers, like the route aggregator.
  - Idempotency guard: refuses if `tests/setup/mockData/<model>.js` already
    exists.
- **Note:** because the body template has no placeholder tokens, "replace
  placeholders" is a no-op — this is the agent most prone to inventing data,
  which is exactly why the `## Rules` block (see Design philosophy) matters most
  here.

### api-create-mock-factory-fn

- **Model:** haiku · **Tools:** Read, Edit
- **Job:** Add a `createMock<Model>` **factory function** to the monolithic
  `tests/setup/mockData.js`. This is the function tests call to insert a mock
  record — it merges the domain data with tenant context and **persists** it
  (`new <Model>(...).save()`), returning the saved document.
- **Not to be confused with `api-create-mock-data`.** Different file, different
  job: `api-create-mock-data` writes the per-domain **data arrays** to the
  `tests/setup/mockData/` **folder**; this agent writes the **factory function**
  to the `tests/setup/mockData.js` **file**. The factory reads the data the
  other agent produced (`mockData.<model>[0]`).
- **Input:** the variants JSON from `api-derive-model-variants` (uses only
  `Model` / `model` — the only scaffold agent besides the two singular-only ones
  that needs just two of the five tokens). No confirmation prompt.
- **Scope:** the **standard persisting factory only** — the
  `createMockProduct` / `createMockCustomer` shape (merge `{ ...data[0], tenant,
  ...options }`, instantiate, `save()`). The special variants in the file are
  left to the developer by design: factories with extra logic (`createMockUser`
  hashes the password, `createMockPurchaseOrder` maps embedded items) and
  non-persisting item factories (`createMockPurchaseOrderItem` returns a plain
  object, no `save()`).
- **Recipe:**
  - Two templates: `mockFactoryImport.template.tmpl` (the model import line
    `import { <Model> } from "../../src/models/index.js";`) and
    `mockFactoryFn.template.tmpl` (the JSDoc + factory function; tokens `<Model>`
    / `<model>`).
  - `Edit`-inserts the import above the **import marker** near the top and the
    factory above the **factory marker** at the bottom — **two** markers, like
    the route aggregator and the mock-data index, because the import and the
    function live in separate regions of the file. The markers are worded
    distinctly (`… import marker` / `… factory marker`) so the substring match
    can't confuse them.
  - Creates no file — a single existing file is edited, so `Read` + `Edit` only
    (no `Write`). This is the tightest tool grant of the scaffold agents.
  - Idempotency guard: refuses if `mockData.js` already contains
    `createMock<Model>`.
- **Keeps the `## Rules` block** even though it is `Edit`-only: unlike the
  single-line insert agents, it writes a multi-line function body, so the
  invention surface is real (see Design philosophy).

### api-create-mock-rolepermission

- **Model:** haiku · **Tools:** Read, Edit
- **Job:** Add a module's permission **block** to the test role (`test-role`, an
  `OVERSEER`) in `tests/setup/mockData/role.js`, granting `access: true` on all
  five CRUD operations so integration tests for the module do not `403`. This is
  the *values* side of test-role permissions.
- **Not to be confused with `api-create-rolepermission-entry`.** Different file,
  different job: that agent adds the one-line `{ type: Map, of: PermissionSchema }`
  **schema slot** to `src/models/roleModel.js` (without which Mongoose strips the
  block on save → `403`); this agent writes the actual **permission values** into
  the test role's mock data. They cover two of the four places a new module's
  permissions must appear — the production seed files
  (`src/scripts/init/data/init*Permissions.json`) are handled by
  `api-create-seed-rolepermission` and the init script's hardcoded
  `rolePermission` object by `api-create-init-rolepermission`.
- **Input:** the variants JSON from `api-derive-model-variants` (uses
  `model` / `Model` / `Models`). No confirmation prompt.
- **Scope:** standard CRUD only — five feature keys (`create<Model>`,
  `read<Models>`, `read<Model>`, `update<Model>`, `delete<Model>`), mirroring the
  `customer` block. **No embedded-item permissions** (`create<Model>Item` …) —
  those belong only to the order modules, and stopping haiku from copying them
  from `purchaseOrder` / `saleOrder` is exactly what the `## Rules` block guards.
- **Recipe:**
  - One template: `mockRolepermissionEntry.template.tmpl` — the full block
    (module key → five `{ access: true, adminTenantOnly: false, immutable: false }`
    entries), indentation baked in, with a **trailing comma**.
  - Tokens `<model>` (module key) and `<Model>` / `<Models>` (feature-key
    casing). The angle-bracket form is collision-safe: `<Model>` is not a
    substring of `<Models>` (the `>` after `l` differs), so literal replacement
    needs no ordering.
  - `Edit`-inserts the block above a marker line inside the `rolePermission`
    object (the marker stays last). The trailing comma keeps repeated inserts
    valid — the previously-last block gets its comma once, when the marker is
    added by hand.
  - Creates no file — a single `Edit`, so `Read` + `Edit` only (no `Write`).
  - Idempotency: none — re-running inserts a duplicate block above the marker
    (JS keeps the last), like `api-create-rolepermission-entry`.
- **Keeps the `## Rules` block** — like `api-create-mock-factory-fn`, it inserts
  multi-line content, so it holds the no-invent rule (only the five template
  keys, no item permissions, no invented feature keys).

### api-eslint

- **Model:** haiku · **Tools:** Bash
- **Job:** Run ESLint on the backend (`npm run lint`) and report PASS/FAIL
  based purely on the exit code. Read-only — never edits or fixes code.
- **Output:** a one-line PASS (with warning count) or a short FAIL summary
  listing the files with problems. Never pastes the full ESLint output.

### api-integration-test

- **Model:** haiku · **Tools:** PowerShell
- **Job:** Run the backend integration tests (`npm test`) and report the
  result. Read-only — never fixes anything.
- **Output:** PASS only if the exit code is 0 **and** a `passed` summary line is
  present; otherwise a short FAIL that distinguishes "suites did not load" from
  "tests ran and some failed", with the failing names/counts.
- **Note:** uses the PowerShell tool deliberately — see [Platform notes](#platform-notes-windows).

### api-smoke

- **Model:** haiku · **Tools:** Skill, Bash
- **Job:** Verify the backend actually boots and serves requests. Invokes the
  `run-erp-demo` skill and runs its driver, which starts the real server against
  a throwaway in-memory MongoDB and drives login + CRUD over HTTP. Read-only.
- **Output:** PASS only if the exit code is 0 **and** the output contains
  `[driver] SMOKE PASSED`; reports login status and product count. On FAIL,
  reports the relevant error line and a likely cause from the skill's
  troubleshooting section.

---

## Workflows (composition)

### Module scaffold chain

The long-term goal is a chain of single-job agents that build a new backend
module one layer at a time, following the project's
`Route → Controller → Service → Model` architecture (built bottom-up):

| Phase | Agent | Status |
|---|---|---|
| variants | `api-derive-model-variants` | ✅ done |
| model | `api-create-model` | ✅ done |
| service | `api-create-module-service` | ✅ done |
| controller | `api-create-module-controller` | ✅ done |
| route | `api-create-module-route` | ✅ done |
| app mount | `api-create-app-mount` | ✅ done |
| permissions — role schema | `api-create-rolepermission-entry` | ✅ done |
| permissions — test role | `api-create-mock-rolepermission` | ✅ done |
| permissions — seed data | `api-create-seed-rolepermission` | ✅ done |
| permissions — init seed script | `api-create-init-rolepermission` | ✅ done |
| tests | `api-create-integration-test` | ✅ done |
| test mock data | `api-create-mock-data` | ✅ done |
| test mock factory | `api-create-mock-factory-fn` | ✅ done |
| swagger docs | *(tbd)* | 🔜 planned |

Notes:

- **Chaining is a later, explicit opt-in.** Wiring these phases into a single
  automated workflow has a real token cost, so it is not enabled by default —
  it is turned on deliberately.
- **A scaffolded route is not reachable until mounted and permitted.**
  `api-create-module-route` creates and registers the route file and
  `api-create-app-mount` mounts it in `app.js`, but the endpoint still returns
  403 until the role grants its permissions — the schema slot
  (`api-create-rolepermission-entry`), the test role
  (`api-create-mock-rolepermission`), the production seed files
  (`api-create-seed-rolepermission`) and the init script's hardcoded
  `rolePermission` object (`api-create-init-rolepermission`) are all covered by
  agents now.
- **The publish step stays manual.** Creating a git branch and opening a PR is
  done by hand, never by the chain.

---

## Platform notes (Windows)

This project is developed on Windows. The verify agents pick their shell to
match what actually works here:

| Tool | Bash (Git Bash) | PowerShell |
|---|---|---|
| Vitest (`npm test`) | ❌ fails | ✅ works |
| ESLint (`npm run lint`) | ✅ works | ✅ works |

This is why `api-integration-test` uses the PowerShell tool while `api-eslint`
uses Bash.

---

## Working with these agents

- **A new or edited agent is only invokable after a session restart.** If you
  create or change an agent mid-session, restart Claude Code before trying to
  run it — otherwise the old (or missing) definition is used.
