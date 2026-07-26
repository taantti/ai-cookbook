import fs from "node:fs";
import { fileURLToPath } from "node:url";

const LOG_BASE = ".claude/ai-engineering/reliability/log";
const REPORT_BASE = ".claude/ai-engineering/reliability/report";

/**
 * Central default: minimum GRADEABLE runs (PASS+FAIL) per variant required to SAVE
 * a report. Below this the run is shown but not saved. Tied to the claim:
 * A 60 → rule-of-three 3/60 = 5%; B 30 → baseline. Overridden per-eval by a
 * "target" note in the log (see getTarget).
 */
const MIN_GRADEABLE = { "A-rules": 60, "B-norules": 30 };

// --- Loading ---

/**
 * List <prefix>-<ts>.<postfix> files in a directory, sorted ascending.
 * @param {string} dir
 * @param {string} [prefix=""] - eval-name prefix to match
 * @param {string} [postfix="log"]
 * @returns {string[]}
 */
const getFiles = (dir, prefix = "", postfix = "log") =>
    fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith(`.${postfix}`))
        .sort();

/**
 * Load and parse the latest matching log file (JSONL → records).
 * @param {string} dir
 * @param {string} [prefix=""] - eval-name prefix; distinguishes evals sharing one folder
 * @param {string} [postfix="log"]
 * @returns {{ file: string, records: object[] }}
 * @throws {Error} if no matching file exists
 */
export const loadLatestLog = (dir, prefix = "", postfix = "log") => {
    const latest = getFiles(dir, prefix, postfix).at(-1);
    if (!latest) throw new Error(`No .${postfix} files matching "${prefix}" in ${dir}`);
    const records = fs.readFileSync(`${dir}/${latest}`, "utf8")
        .trim().split("\n").filter(Boolean)
        .map(line => JSON.parse(line));
    return { file: latest, records };
};

// --- Aggregation & stats ---

/**
 * Tally run records into per-variant, per-case verdict counts plus a total.
 * @param {object[]} records
 * @returns {Object<string, { cases: object, total: {PASS:number,FAIL:number,ERROR:number} }>}
 */
const aggregate = (records) => {
    const blank = () => ({ PASS: 0, FAIL: 0, ERROR: 0 });
    const agg = {};
    for (const record of records) {
        if (record.type !== "run") continue;
        agg[record.variant] ??= { cases: {}, total: blank() };
        agg[record.variant].cases[record.input] ??= blank();
        agg[record.variant].cases[record.input][record.verdict]++;
        agg[record.variant].total[record.verdict]++;
    }
    return agg;
};

/**
 * Derive statistics from one verdict-count object.
 * @param {{PASS:number, FAIL:number, ERROR:number}} counts
 * @returns {{ gradeable:number, rate:number|null, bound:number|null }}
 *   rate = FAIL/gradeable (null if 0 gradeable); bound = rule-of-three 3/gradeable (only when FAIL 0)
 */
const stats = ({ PASS, FAIL }) => {
    const gradeable = PASS + FAIL;
    const rate = gradeable === 0 ? null : FAIL / gradeable;
    const bound = (gradeable > 0 && FAIL === 0) ? 3 / gradeable : null;
    return { gradeable, rate, bound };
};

/**
 * Read the per-variant gradeable target from a "target" log note, or fall back to MIN_GRADEABLE.
 * @param {object[]} records
 * @returns {Object<string, number>}
 */
const getTarget = (records) => {
    const note = records.find(r => r.type === "note" && r.msg === "target");
    return note?.target ?? MIN_GRADEABLE;
};

// --- Rendering ---

/**
 * Format a 0..1 ratio as a percentage, or "—" for null.
 * @param {number|null} x
 * @returns {string}
 */
const pct = (x) => x === null ? "—" : (x * 100).toFixed(1) + "%";

/**
 * Render one markdown table row from a verdict-count object.
 * @param {string} variant
 * @param {string} name - case name, or a label like "**total**"
 * @param {{PASS:number,FAIL:number,ERROR:number}} c
 * @returns {string}
 */
const renderRow = (variant, name, c) => {
    const s = stats(c);
    return `| ${variant} | ${name} | ${c.PASS} | ${c.FAIL} | ${c.ERROR} | ${s.gradeable} | ${pct(s.rate)} |`;
};

/**
 * Render the per-variant × per-case results table.
 * @param {object} agg
 * @returns {string} markdown
 */
const renderTable = (agg) => {
    const header =
        "| Variant | Case | PASS | FAIL | ERROR | Gradeable | Halluc-% |\n" +
        "|---|---|---|---|---|---|---|";
    const rows = [];
    for (const [variant, data] of Object.entries(agg)) {
        for (const [name, c] of Object.entries(data.cases)) rows.push(renderRow(variant, name, c));
        rows.push(renderRow(variant, "**total**", data.total));
    }
    return [header, ...rows].join("\n");
};

/**
 * Render the per-variant summary (observed rate + rule-of-three upper bound).
 * @param {object} agg
 * @returns {string} markdown
 */
const renderSummary = (agg) => {
    const lines = [];
    for (const [variant, data] of Object.entries(agg)) {
        const s = stats(data.total);
        const claim = s.bound !== null
            ? `${data.total.FAIL}/${s.gradeable} → ${pct(s.rate)} observed, true rate ≤ ${pct(s.bound)} (95% upper bound, rule of three)`
            : `${data.total.FAIL}/${s.gradeable} → ${pct(s.rate)} observed`;
        lines.push(`- **${variant}**: ${claim} (${data.total.ERROR} ERROR excluded)`);
    }
    return "## Summary\n\n" + lines.join("\n");
};

/**
 * Render the report metadata header (source log, run count, cost, timestamp).
 * @param {string} file
 * @param {object[]} records
 * @returns {string} markdown
 */
const renderMeta = (file, records) => {
    const runs = records.filter(r => r.type === "run");
    const cost = runs.reduce((sum, r) => sum + (r.cost || 0), 0);
    return [
        "# Eval report",
        "",
        `- Source log: \`${file}\``,
        `- Runs: ${runs.length}`,
        `- Notional cost: $${cost.toFixed(4)}`,
        `- Generated: ${new Date().toISOString()}`,
    ].join("\n");
};

/**
 * Render a one-line conclusion naming the lowest- and highest-rate variants.
 * Generic: the labels carry the meaning; interpretation is left to the reader.
 * @param {object} agg
 * @returns {string} markdown ("" if fewer than two gradeable variants)
 */
const renderConclusion = (agg) => {
    const rows = Object.entries(agg)
        .map(([variant, data]) => ({ variant, fail: data.total.FAIL, ...stats(data.total) }))
        .filter(r => r.rate !== null);
    if (rows.length < 2) return "";
    const best = rows.reduce((a, b) => (a.rate <= b.rate ? a : b));
    const worst = rows.reduce((a, b) => (a.rate >= b.rate ? a : b));
    const fmt = (r) => r.bound !== null
        ? `\`${r.variant}\` (${r.fail}/${r.gradeable}, true rate ≤ ${pct(r.bound)})`
        : `\`${r.variant}\` (${r.fail}/${r.gradeable}, ${pct(r.rate)} observed)`;
    return `## Conclusion\n\nLowest hallucination rate: ${fmt(best)}. Highest: ${fmt(worst)}.`;
};

/**
 * Assemble the full markdown report.
 * @param {object} agg
 * @param {string} file - source log filename (for metadata)
 * @param {object[]} records - raw records (for metadata)
 * @returns {string} markdown
 */
const renderReport = (agg, file, records) =>
    [renderMeta(file, records), renderConclusion(agg), renderSummary(agg), renderTable(agg)]
        .filter(Boolean)
        .join("\n\n");

// --- CLI entry (runs only when executed directly, not when imported) ---

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const [agent, evalName] = process.argv.slice(2);
    if (!agent || !evalName) {
        console.error("Usage: node eval-report.js <agent> <evalName>");
        console.error("  e.g.  node eval-report.js mock-data eval-hallucination");
        process.exit(1);
    }

    const { file, records } = loadLatestLog(`${LOG_BASE}/${agent}`, evalName);
    const agg = aggregate(records);
    const target = getTarget(records);
    const underpowered = Object.keys(target).some(v =>
        ((agg[v]?.total.PASS ?? 0) + (agg[v]?.total.FAIL ?? 0)) < target[v]);

    const report = renderReport(agg, file, records);
    console.log(report);   // always show

    if (underpowered) {
        console.warn("\n⚠ UNDERPOWERED — report NOT saved (gradeable < target). Test run?");
    } else {
        const reportDir = `${REPORT_BASE}/${agent}`;
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(`${reportDir}/${evalName}.md`, report);
        console.log("\nSaved: " + `${reportDir}/${evalName}.md`);
    }
}
