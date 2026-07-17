export const meta = {
  name: 'scaffold-module',
  description: 'Scaffold a whole backend module from a raw model name',
  phases: [
    { title: 'Variants' },
    { title: 'Scaffold' },
    { title: 'Verify' },
  ],
}

// Shape we force api-derive-model-variants to return — a validated object, no JSON.parse needed.
const VARIANTS_SCHEMA = {
  type: 'object',
  properties: {
    Model:         { type: 'string' },
    model:         { type: 'string' },
    Models:        { type: 'string' },
    models:        { type: 'string' },
    'model-kebab': { type: 'string' },
  },
  required: ['Model', 'model', 'Models', 'models', 'model-kebab'],
}

// Phase 1 — variants. BARRIER: every downstream agent needs this object.
// Prompt is ONLY the raw name (args) — this agent treats the whole message as the name.
phase('Variants')
const variants = await agent(`${args}`, {
  agentType: 'api-derive-model-variants',
  schema: VARIANTS_SCHEMA,
  label: 'derive-variants',
})
const input = JSON.stringify(variants) // the one JSON every scaffold agent consumes
log(`Variants: ${input}`)

// Phase 2 — all 12 scaffold agents in parallel. Each writes a disjoint set of files and
// none reads another's output, so this is safe with no worktree isolation.
// Listed bottom-up (Model → Service → Controller → Route → mount → permissions → tests)
// for readability; parallel() runs them concurrently regardless of order.
const SCAFFOLD = [
  'api-create-model',
  'api-create-module-service',
  'api-create-module-controller',
  'api-create-module-route',
  'api-create-app-mount',
  'api-create-rolepermission-entry',
  'api-create-seed-rolepermission',
  'api-create-init-rolepermission',
  'api-create-integration-test',
  'api-create-mock-data',
  'api-create-mock-factory-fn',
  'api-create-mock-rolepermission',
]

// parallel() takes THUNKS (() => ...), not live promises, so it controls when each starts.
// Inside the block we use the `phase` OPTION (not the global phase()) to avoid a race.
// BARRIER: await waits for all 12 before the script continues.
const results = await parallel(
  SCAFFOLD.map((type) => () =>
    agent(input, { agentType: type, phase: 'Scaffold', label: type })
  )
)

// Phase 3 — verify by running. BARRIER: starts only after every file is written.
// All three are read-only (no repo writes) and use isolated ephemeral resources
// (each spins its own in-memory Mongo; smoke binds a real port while the tests run
// in-process via supertest), so they run concurrently with no contention.
phase('Verify')
const VERIFY = ['api-eslint', 'api-integration-test', 'api-smoke']
const verify = await parallel(
  VERIFY.map((type) => () =>
    agent('Run your verification of the backend and report PASS/FAIL.', {
      agentType: type,
      phase: 'Verify',
      label: type,
    })
  )
)

// results[i]/verify[i] is null if that agent died — surface which, so a failure is visible.
return {
  variants,
  scaffold: SCAFFOLD.map((type, i) => ({
    agent: type,
    ok: results[i] != null,
    report: results[i],
  })),
  verify: VERIFY.map((type, i) => ({
    agent: type,
    ok: verify[i] != null,
    report: verify[i],
  })),
}
