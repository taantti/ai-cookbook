/**
 * run-erp-demo driver
 * -------------------
 * Boots the REAL erp-demo server (src/server.js) against a throwaway in-memory
 * MongoDB replica set, seeds one tenant + OVERSEER role + user, then drives the
 * running HTTP API end-to-end (login -> list -> create -> list) with fetch.
 *
 * There is no external Mongo and no .env needed: this owns the whole lifecycle.
 *
 * Usage (from the unit root, c:\Muuta\erp-demo):
 *   node .claude/skills/run-erp-demo/driver.mjs           # full smoke, exits 0/1
 *   node .claude/skills/run-erp-demo/driver.mjs --serve   # seed + serve, stay up
 *
 * In --serve mode it prints the base URL, a ready-to-use JWT and the login
 * credentials, then blocks until Ctrl-C so you can curl / open Swagger yourself.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
    createMockTenant,
    createMockRole,
    createMockUser
} from "../../../tests/setup/mockData.js";
import mockUserData from "../../../tests/setup/mockData/user.js"

const UNIT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const PORT = process.env.DRIVER_PORT || "3020";
const BASE = `http://localhost:${PORT}`;
const SERVE = process.argv.includes("--serve");

const JWT_SECRET_KEY = "run-skill-dev-secret";
let replSet = null;
let server = null;

/** Stop the child server and the in-memory replica set, ignoring errors. */
async function cleanup() {
    if (server && !server.killed) server.kill();
    try { await mongoose.disconnect(); } catch { /* noop */ }
    if (replSet) { try { await replSet.stop(); } catch { /* noop */ } }
}

/** Poll the running server until it answers HTTP (or time out). */
async function waitForServer(timeoutMs = 30000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        try {
            // Any HTTP status means the listener is up. Use the public Swagger
            // route with GET so we don't trip the "missing POST body" guard.
            const res = await fetch(`${BASE}/api-docs/`);
            if (res.status) return true;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

async function main() {
    console.log("[driver] starting in-memory MongoDB replica set...");
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri();
    console.log("[driver] mongo uri:", uri);

    // Seed via the same models the app uses (default mongoose connection).
    await mongoose.connect(uri);
    await createMockTenant();
    await createMockRole();
    await createMockUser();
    console.log(`[driver] seeded tenant + OVERSEER role + user (${mockUserData[0].username})`);

    // Launch the ACTUAL server as a child process against the same DB.
    console.log("[driver] launching src/server.js on port", PORT);
    server = spawn("node", ["src/server.js"], {
        cwd: UNIT_ROOT,
        env: {
            ...process.env,
            DATABASE_URI: uri,
            PORT,
            JWT_SECRET_KEY,
            JWT_TOKEN_EXPIRATION: "1h",
            BCRYPT_SALT_ROUNDS: "10",
            CORS_ORIGIN: "*",
            LOG_LEVEL: "INFO",
            LOG_TO_FILE: "false",
        },
        stdio: ["ignore", "inherit", "inherit"],
    });
    server.on("exit", (code) => {
        if (code && code !== 0 && !SERVE) console.error("[driver] server exited with", code);
    });

    await waitForServer();
    console.log("[driver] server is up at", BASE);

    // --- Drive the running API over HTTP ---
    const login = await fetch(`${BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: mockUserData[0].username, password: mockUserData[0].password }),
    });
    const loginBody = await login.json();
    const token = loginBody.login;
    if (!token) throw new Error(`login failed: ${login.status} ${JSON.stringify(loginBody)}`);
    console.log(`[driver] POST /login  -> ${login.status}, got JWT (${token.slice(0, 20)}...)`);

    const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    const list1 = await fetch(`${BASE}/product`, { headers: authHeaders });
    const list1Body = await list1.json();
    console.log(`[driver] GET  /product -> ${list1.status}, ${(list1Body.data ?? list1Body).length ?? "?"} product(s)`);

    const create = await fetch(`${BASE}/product`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: "Driver Widget", sku: "DRIVER-WIDGET-1", unit: "piece", active: true }),
    });
    const createBody = await create.json();
    console.log(`[driver] POST /product -> ${create.status}, created "${(createBody.data ?? createBody)?.name ?? createBody?.name}"`);

    const list2 = await fetch(`${BASE}/product`, { headers: authHeaders });
    const list2Body = await list2.json();
    const count = (list2Body.data ?? list2Body).length;
    console.log(`[driver] GET  /product -> ${list2.status}, ${count} product(s) after create`);

    const ok = login.status === 200 && create.status === 201 && count >= 1;

    if (SERVE) {
        console.log("\n[driver] --serve mode: server staying up. Press Ctrl-C to stop.");
        console.log(`[driver]   Base URL : ${BASE}`);
        console.log(`[driver]   Swagger  : ${BASE}/api-docs`);
        console.log(`[driver]   Login    : ${mockUserData[0].username} / ${mockUserData[0].password}`);
        console.log(`[driver]   JWT      : ${token}`);
        await new Promise(() => { /* block forever */ });
    }

    await cleanup();
    console.log(ok ? "\n[driver] SMOKE PASSED" : "\n[driver] SMOKE FAILED");
    process.exit(ok ? 0 : 1);
}

process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

main().catch(async (err) => {
    console.error("[driver] ERROR:", err.message);
    await cleanup();
    process.exit(1);
});
