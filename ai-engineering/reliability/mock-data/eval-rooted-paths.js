import {
    preFlight, resetWorkspace, runAgent, normalize, isRootedPath, grade,
    getCliVersion, removeGhostTwin, findTranscript, transcriptInputValues
} from "../utils/evalHelpers.js";
import { createEvalLogger } from "../utils/evalLogger.js";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// --- Configuration ---

/** Model-name inputs (the variants JSON the chain would supply), varying temptation level. */
const CASES = [
    { Model: "ColdStorageZone", model: "coldStorageZone", Models: "ColdStorageZones", models: "coldStorageZones", "model-kebab": "cold-storage-zone" },
    { Model: "DeliveryTruck", model: "deliveryTruck", Models: "DeliveryTrucks", models: "deliveryTrucks", "model-kebab": "delivery-truck" },
    { Model: "LoyaltyProgram", model: "loyaltyProgram", Models: "LoyaltyPrograms", models: "loyaltyPrograms", "model-kebab": "loyalty-program" },
    { Model: "QualityInspection", model: "qualityInspection", Models: "QualityInspections", models: "qualityInspections", "model-kebab": "quality-inspection" },
    { Model: "Zzyzx", model: "zzyzx", Models: "Zzyzxes", models: "zzyzxes", "model-kebab": "zzyzx" },
];


const REPEATS_A = 15; // variant A (Paths block): 5 cases × 15 = 75 scheduled
const REPEATS_B = 12;  // variant B (without Paths block): 5 cases × 12  = 60 scheduled (baseline confirmation, not tightly bounded)
const REPEATS_C = 1;  // debug: 5 cases × 1 = 5 total (cheap smoke)

const MOCKDATADIR = "tests/setup/mockData";
const TEMPLATE = fs.readFileSync(".claude/templates/mockData.template.tmpl", "utf8");

const VARIANTS = [
    { agent: "api-create-mock-data", repeats: REPEATS_A, label: "A-pathrule" },
    { agent: "api-create-mock-data-nopaths", repeats: REPEATS_B, label: "B-nopaths" },
];

const logger = createEvalLogger("eval-rooted-paths", { dir: ".claude/ai-engineering/reliability/log/mock-data" });

// --- Run helpers ---

/**
 * Verdict for one run: FAIL beats ERROR beats PASS
 * @param {string[]} rootedPaths 
 * @param {object} result 
 * @returns {"PASS"|"FAIL"|"ERROR"}
 */
const getGradeResult = (rootedPaths, result) => {
    if (rootedPaths.length) return "FAIL";
    if (result.status !== "ok") return "ERROR";
    return "PASS";
};

/**
 * Evidence for a FAIL verdict: the rooted paths, one per line.
 * @param {string} gradeResult - "PASS" | "FAIL" | "ERROR"
 * @param {string[]} rootedPaths
 * @returns {string|null} null unless gradeResult is "FAIL"
 */
const getFailContent = (gradeResult, rootedPaths) => {
    if (gradeResult === "FAIL") return rootedPaths.join("\n");
    return null;
}

/**
 * One run for one case: reset workspace, run the agent with a fresh session
 * id, read its tool-call paths from the transcript, grade by rooted paths,
 * reset again.
 * @param {string} agentName
 * @param {object} caseModel - one CASES entry
 * @returns {{ gradeResult: "PASS"|"FAIL"|"ERROR", total_cost_usd: number, model: string|null,
 *   errorDetail: string|null, failContent: string|null,
 *   extra: { scaffoldOk: boolean, pathCount: number, denialCount: number } }}
 */
const runCase = (agentName, caseModel) => {
    const actualPath = `${MOCKDATADIR}/${caseModel.model}.js`;
    const resetParams = { delete: [actualPath], reset: [`${MOCKDATADIR}/index.js`] };

    resetWorkspace(resetParams);
    if (fs.existsSync(actualPath)) throw new Error(`Reset failed: ${actualPath} still present after cleanup (node-side) — aborting to protect measurement validity.`);

    const ghostCandidates = [actualPath, `${MOCKDATADIR}/index.js`];
    for (const ghostCandidate of ghostCandidates) if (removeGhostTwin(ghostCandidate)) logger.note(`ghost twin removed before run: /${ghostCandidate}`);

    const uuid = randomUUID();
    const result = runAgent(agentName, JSON.stringify(caseModel), uuid);

    const scaffoldOk = "PASS" === grade(result, TEMPLATE, actualPath);

    for (const ghostCandidate of ghostCandidates) if (removeGhostTwin(ghostCandidate)) logger.note(`ghost twin removed after run (agent wrote a drive-root path): /${ghostCandidate}`);
    resetWorkspace(resetParams);

    const inputValues = transcriptInputValues(findTranscript(uuid));
    const rootedPaths = inputValues.filter(inputValue => isRootedPath(inputValue));
    const gradeResult = getGradeResult(rootedPaths, result);
    const failContent = getFailContent(gradeResult, rootedPaths);

    const parsed = result.status === "ok" ? JSON.parse(result.raw) : null;
    const total_cost_usd = parsed?.total_cost_usd ?? 0;
    const model = parsed?.modelUsage ? Object.keys(parsed.modelUsage).join(",") : null;

    let errorDetail = null;
    if (gradeResult === "ERROR") {
        errorDetail = `runAgent error: ${result.message}`;
        console.error("  " + errorDetail);
    }

    return {
        gradeResult, total_cost_usd, model, errorDetail, failContent,
        extra: { scaffoldOk: scaffoldOk, pathCount: inputValues.length, denialCount: parsed?.permission_denials?.length ?? 0 }
    };
};

/**
 * Assert the two agent variants differ ONLY in their ## Paths section — otherwise
 * B is not a clean control and the A/B comparison is invalid.
 * @throws {Error} if the bodies differ outside the ## Paths section
 */
const assertVariantsInSync = () => {
    const dir = ".claude/agents/api-create-mock-data";
    const bodyMinusPaths = (file) => {
        const content = fs.readFileSync(`${dir}/${file}`, "utf8");
        const body = content.split(/^---$/m)[2] ?? ""; // drop frontmatter
        return normalize(body.replace(/## Paths\n[\s\S]*?\n(## Boundaries)/, "$1"));
    };
    if (bodyMinusPaths("api-create-mock-data.md") !== bodyMinusPaths("api-create-mock-data.nopaths.md"))
        throw new Error("Variant drift: the two api-create-mock-data files differ outside the ## Paths section. Re-sync per the folder README.");
};

// --- Main ---

try {
    preFlight([MOCKDATADIR]);
    assertVariantsInSync();
    logger.note("meta", {
        cliVersion: getCliVersion(),
        metric: "rooted rate",
        metricCol: "Rooted-%"
    });

    logger.note("target", { target: { "A-pathrule": 60, "B-nopaths": 30 } });

    for (const variant of VARIANTS) {
        for (const caseModel of CASES) {
            const results = [];
            for (let i = 0; i < variant.repeats; i++) {
                const { gradeResult, total_cost_usd, model, errorDetail, failContent, extra } = runCase(variant.agent, caseModel);
                logger.run({
                    variant: variant.label, agent: variant.agent, input: caseModel.model,
                    label: `${caseModel.model} #${i + 1}`, verdict: gradeResult,
                    cost: total_cost_usd, model, errorDetail, failContent, extra,
                });
                results.push({ variant: variant.label, model: caseModel.model, gradeResult, total_cost_usd, failContent, extra });
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
