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
 * Load and parse one specific log file (JSONL → records).
 * @param {string} dir
 * @param {string} file - log filename inside dir
 * @returns {{ file: string, records: object[] }}
 */
export const loadLog = (dir, file) => {
    const records = fs.readFileSync(`${dir}/${file}`, "utf8")
        .trim().split("\n").filter(Boolean)
        .map(line => JSON.parse(line));
    return { file, records };
};

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
    return loadLog(dir, latest);
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
 * @param {string} [metricCol="Halluc-%"] - rate-column header (a "meta" log note's `metricCol` overrides)
 * @returns {string} markdown
 */
const renderTable = (agg, metricCol = "Halluc-%") => {
    const header =
        `| Variant | Case | PASS | FAIL | ERROR | Gradeable | ${metricCol} |\n` +
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
 * Render the report metadata header (source log, model, CLI version, run count,
 * cost, timestamp). Model comes from per-run `model` fields, CLI version from a
 * "meta" log note; both render as "not recorded" for logs predating that logging.
 * @param {string} file
 * @param {object[]} records
 * @returns {string} markdown
 */
const renderMeta = (file, records) => {
    const runs = records.filter(r => r.type === "run");
    const cost = runs.reduce((sum, r) => sum + (r.cost || 0), 0);
    const meta = records.find(r => r.type === "note" && r.msg === "meta");
    const models = [...new Set(runs.map(r => r.model).filter(Boolean))];
    return [
        "# Eval report",
        "",
        `- Source log: \`${file}\``,
        `- Model: ${models.length ? models.map(m => `\`${m}\``).join(", ") : "not recorded in this log"}`,
        `- Claude CLI: ${meta?.cliVersion ?? "not recorded in this log"}`,
        `- Runs: ${runs.length}`,
        `- Notional cost: $${cost.toFixed(4)}`,
        `- Generated: ${new Date().toISOString()}`,
    ].join("\n");
};

/**
 * Render a one-line conclusion naming the lowest- and highest-rate variants.
 * Generic: the labels carry the meaning; interpretation is left to the reader.
 * @param {object} agg
 * @param {string} [metricName="hallucination rate"] - a "meta" log note's `metric` overrides
 * @returns {string} markdown ("" if fewer than two gradeable variants)
 */
const renderConclusion = (agg, metricName = "hallucination rate") => {
    const rows = Object.entries(agg)
        .map(([variant, data]) => ({ variant, fail: data.total.FAIL, ...stats(data.total) }))
        .filter(r => r.rate !== null);
    if (rows.length < 2) return "";
    const best = rows.reduce((a, b) => (a.rate <= b.rate ? a : b));
    const worst = rows.reduce((a, b) => (a.rate >= b.rate ? a : b));
    const fmt = (r) => r.bound !== null
        ? `\`${r.variant}\` (${r.fail}/${r.gradeable}, true rate ≤ ${pct(r.bound)})`
        : `\`${r.variant}\` (${r.fail}/${r.gradeable}, ${pct(r.rate)} observed)`;
    return `## Conclusion\n\nLowest ${metricName}: ${fmt(best)}. Highest: ${fmt(worst)}.`;
};

/**
 * Render the FAIL/ERROR appendices from run records.
 * FAILs render their captured output (`failContent`); ERRORs render their CLI
 * error / result text (`errorDetail`) or an explicit "not recorded" line for
 * logs predating errorDetail logging. Returns "" when there is nothing to show.
 * @param {object[]} records
 * @returns {string} markdown
 */
const renderAppendix = (records) => {
    const runs = records.filter(r => r.type === "run");
    const sections = [];

    const fails = runs.filter(r => r.verdict === "FAIL" && r.failContent);
    if (fails.length) {
        const blocks = fails.map(r =>
            `### ${r.variant} · ${r.input} · ${r.ts}\n\n\`\`\`js\n${r.failContent.trimEnd()}\n\`\`\``);
        sections.push("## Appendix: FAIL outputs\n\n" + blocks.join("\n\n"));
    }

    const errors = runs.filter(r => r.verdict === "ERROR");
    if (errors.length) {
        const blocks = errors.map(r =>
            `### ${r.variant} · ${r.input} · ${r.ts} (attempts: ${r.attempts})\n\n` +
            (r.errorDetail ? "```\n" + r.errorDetail.trim() + "\n```" : "_Error detail not recorded in this log._"));
        sections.push("## Appendix: ERROR runs\n\n" + blocks.join("\n\n"));
    }

    return sections.join("\n\n");
};

/**
 * Load the hand-maintained notes file for an eval, if present. Notes live next
 * to the report as `<evalName>.notes.md` and are inlined into the generated
 * report so regeneration never loses them.
 * @param {string} reportDir
 * @param {string} evalName
 * @returns {string} notes markdown ("" when absent)
 */
const loadNotes = (reportDir, evalName) => {
    const notesPath = `${reportDir}/${evalName}.notes.md`;
    return fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf8").trim() : "";
};

/**
 * Assemble the full markdown report. The log's "meta" note may carry
 * `metric`/`metricCol` labels (e.g. "rooted rate" / "Rooted-%"); absent
 * those, the hallucination-eval defaults apply.
 * @param {object} agg
 * @param {string} file - source log filename (for metadata)
 * @param {object[]} records - raw records (for metadata, labels, appendices)
 * @param {string} [notes=""] - hand-maintained notes markdown to inline
 * @returns {string} markdown
 */
const renderReport = (agg, file, records, notes = "") => {
    const meta = records.find(r => r.type === "note" && r.msg === "meta");
    return [
        renderMeta(file, records),
        renderConclusion(agg, meta?.metric ?? undefined),
        renderSummary(agg),
        renderTable(agg, meta?.metricCol ?? undefined),
        notes,
        renderAppendix(records),
    ].filter(Boolean).join("\n\n");
};

// --- CLI entry (runs only when executed directly, not when imported) ---

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const [agent, evalName, logFile] = process.argv.slice(2);
    if (!agent || !evalName) {
        console.error("Usage: node eval-report.js <agent> <evalName> [logFile]");
        console.error("  e.g.  node eval-report.js mock-data eval-hallucination");
        console.error("  logFile: report a specific log instead of the latest one");
        console.error("           (e.g. when the latest log is an investigation run, not the authoritative one)");
        process.exit(1);
    }

    const { file, records } = logFile
        ? loadLog(`${LOG_BASE}/${agent}`, logFile)
        : loadLatestLog(`${LOG_BASE}/${agent}`, evalName);
    const agg = aggregate(records);
    const target = getTarget(records);
    const underpowered = Object.keys(target).some(v =>
        ((agg[v]?.total.PASS ?? 0) + (agg[v]?.total.FAIL ?? 0)) < target[v]);

    const reportDir = `${REPORT_BASE}/${agent}`;
    const report = renderReport(agg, file, records, loadNotes(reportDir, evalName));
    console.log(report);   // always show

    if (underpowered) {
        console.warn("\n⚠ UNDERPOWERED — report NOT saved (gradeable < target). Test run?");
    } else {
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(`${reportDir}/${evalName}.md`, report + "\n");
        console.log("\nSaved: " + `${reportDir}/${evalName}.md`);
    }
}
