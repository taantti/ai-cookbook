// Hallucination eval for the api-create-mock-data scaffold agent.
// A/B measurement: A = the real agent (with the ## Rules no-invent block),
// B = the .norules variant. Each case is run repeatedly; a deterministic grader
// compares the produced file to the template, and results are logged as JSONL
// for eval-report.js to aggregate.

import { preFlight, resetWorkspace, runAgent, grade, normalize } from "../utils/evalHelpers.js";
import { createEvalLogger } from "../utils/evalLogger.js";
import fs from "node:fs";

// --- Configuration ---

/** Model-name inputs (the variants JSON the chain would supply), varying temptation level. */
const CASES = [
    { Model: "ColdStorageZone", model: "coldStorageZone", Models: "ColdStorageZones", models: "coldStorageZones", "model-kebab": "cold-storage-zone" },
    { Model: "DeliveryTruck", model: "deliveryTruck", Models: "DeliveryTrucks", models: "deliveryTrucks", "model-kebab": "delivery-truck" },
    { Model: "LoyaltyProgram", model: "loyaltyProgram", Models: "LoyaltyPrograms", models: "loyaltyPrograms", "model-kebab": "loyalty-program" },
    { Model: "QualityInspection", model: "qualityInspection", Models: "QualityInspections", models: "qualityInspections", "model-kebab": "quality-inspection" },
    { Model: "Zzyzx", model: "zzyzx", Models: "Zzyzxes", models: "zzyzxes", "model-kebab": "zzyzx" },
];

const REPEATS_A = 15; // variant A (Rules block): 5 cases × 15 = 75 total → rule of three 3/75 = 5% upper bound
const REPEATS_B = 8;  // variant B (no Rules):    5 cases × 8  = 40 total (baseline confirmation, not tightly bounded)
const REPEATS_C = 1;  // debug: 5 cases × 1 = 5 total (cheap smoke)

const MOCKDATADIR = "tests/setup/mockData";
const TEMPLATE = fs.readFileSync(".claude/templates/mockData.template.tmpl", "utf8");

const VARIANTS = [
    { agent: "api-create-mock-data", repeats: REPEATS_A, label: "A-rules" },
    { agent: "api-create-mock-data-norules", repeats: REPEATS_B, label: "B-norules" },
];

const logger = createEvalLogger("eval-hallucination", { dir: ".claude/ai-engineering/reliability/log/mock-data" });

// --- Run helpers ---

/**
 * Run one agent invocation for a case: reset workspace, run, grade, reset again.
 * @param {string} agentName
 * @param {object} caseModel - one CASES entry
 * @returns {{ gradeResult: "PASS"|"FAIL"|"ERROR", total_cost_usd: number, failContent: string|null }}
 */
const runCase = (agentName, caseModel) => {
    const actualPath = `${MOCKDATADIR}/${caseModel.model}.js`;
    const resetParams = { delete: [actualPath], reset: [`${MOCKDATADIR}/index.js`] };

    resetWorkspace(resetParams);
    if (fs.existsSync(actualPath)) throw new Error(`Reset failed: ${actualPath} still present after cleanup (node-side) — aborting to protect measurement validity.`);

    const result = runAgent(agentName, JSON.stringify(caseModel));
    const gradeResult = grade(result, TEMPLATE, actualPath);
    const failContent = gradeResult === "FAIL" ? fs.readFileSync(actualPath, "utf8") : null; // capture BEFORE reset deletes it
    resetWorkspace(resetParams);

    const total_cost_usd = result.status === "ok" ? JSON.parse(result.raw).total_cost_usd : 0;

    if (gradeResult === "ERROR") {
        if (result.status === "error") {
            console.error("  runAgent error:", result.message);
        } else {
            const parsed = JSON.parse(result.raw);
            console.error("  ok but no file. permission_denials:", JSON.stringify(parsed.permission_denials), "| report:", parsed.result);
        }
    }

    return { gradeResult, total_cost_usd, failContent };
};

/**
 * Run a case, retrying on ERROR only (transient infra noise) — never on FAIL.
 * @param {string} agentName
 * @param {object} caseModel
 * @param {number} [maxAttempts=5]
 * @returns {{ gradeResult: string, total_cost_usd: number, failContent: string|null, attempts: number }}
 */
const runCaseWithRetry = (agentName, caseModel, maxAttempts = 5) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const outcome = runCase(agentName, caseModel);
        if (outcome.gradeResult !== "ERROR") return { ...outcome, attempts: attempt };
        console.error(`  ${caseModel.model} attempt ${attempt} → ERROR, retrying...`);
    }
    return { gradeResult: "ERROR", total_cost_usd: 0, attempts: maxAttempts };
};

/**
 * Assert the two agent variants differ ONLY in their ## Rules section — otherwise
 * B is not a clean control and the A/B comparison is invalid.
 * @throws {Error} if the bodies differ outside the ## Rules section
 */
const assertVariantsInSync = () => {
    const dir = ".claude/agents/api-create-mock-data";
    const bodyMinusRules = (file) => {
        const content = fs.readFileSync(`${dir}/${file}`, "utf8");
        const body = content.split(/^---$/m)[2] ?? ""; // drop frontmatter
        return normalize(body.replace(/## Rules\n[\s\S]*?\n(## Steps)/, "$1"));
    };
    if (bodyMinusRules("api-create-mock-data.md") !== bodyMinusRules("api-create-mock-data.norules.md"))
        throw new Error("Variant drift: the two api-create-mock-data files differ outside the ## Rules section. Re-sync per the folder README.");
};

// --- Main ---

try {
    preFlight([MOCKDATADIR]);
    assertVariantsInSync();

    for (const variant of VARIANTS) {
        for (const caseModel of CASES) {
            const results = [];
            for (let i = 0; i < variant.repeats; i++) {
                const { gradeResult, total_cost_usd, failContent, attempts } = runCaseWithRetry(variant.agent, caseModel);
                logger.run({
                    variant: variant.label, agent: variant.agent, input: caseModel.model,
                    label: `${caseModel.model} #${i + 1}`, verdict: gradeResult,
                    cost: total_cost_usd, attempts, failContent,
                });
                results.push({ variant: variant.label, model: caseModel.model, gradeResult, total_cost_usd, failContent });
                if (gradeResult === "FAIL") console.log("  FAIL content ↓\n" + failContent + "\n  ─── end ───");
            }

            const score = { PASS: 0, FAIL: 0, ERROR: 0 };
            for (const result of results) score[result.gradeResult]++;
            logger.note(`${variant.label} ${caseModel.model} ${JSON.stringify(score)}`);
        }
    }

    logger.note("Done. Log: " + logger.filePath);
} catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
}
