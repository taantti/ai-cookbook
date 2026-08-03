import fs from "node:fs";

const DEFAULT_DIR = ".claude/ai-engineering/reliability/log";

/**
 * Create a logger that appends one JSON record per line (JSONL) to a fresh
 * `<dir>/<evalName>-<timestamp>.log` file.
 *
 * @param {string} evalName - base name of the log file, e.g. "eval-hallucination"
 * @param {object} [opts]
 * @param {string}  [opts.dir]  - directory for the log file (default: DEFAULT_DIR)
 * @param {boolean} [opts.echo] - also print a human-readable line to the console (default: true)
 * @returns {{ filePath: string, run: Function, note: Function, read: Function }}
 */
export const createEvalLogger = (evalName, { dir = DEFAULT_DIR, echo = true } = {}) => {
    if (!evalName) throw new Error("createEvalLogger: evalName is required");
    const filePath = `${dir}/${evalName}-${Date.now()}.log`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, "");
    const write = (record) => fs.appendFileSync(filePath, JSON.stringify(record) + "\n");

    return {
        filePath,

        /**
         * Record one agent run. Only `verdict` is required.
         * @param {object} r
         * @param {string} [r.variant]     - e.g. "A-rules" / "B-norules"
         * @param {string} [r.agent]       - agent name invoked
         * @param {*}      [r.input]        - the case input (stored verbatim in the record)
         * @param {string} [r.label]        - short human label for the console line
         * @param {string}  r.verdict       - "PASS" | "FAIL" | "ERROR" (or any eval's verdicts)
         * @param {number} [r.cost]         - notional cost for the run
         * @param {number} [r.attempts]     - attempts taken (retries)
         * @param {string} [r.model]        - model id(s) the CLI reported for the run
         * @param {string} [r.errorDetail]  - CLI error / agent result text on ERROR (for the report appendix)
         * @param {string} [r.failContent]  - captured output on FAIL (for the report appendix)
         */
        run: ({ variant = null, agent = null, input = null, label = null,
                verdict, cost = 0, attempts = 1, model = null, errorDetail = null, failContent = null }) => {
            if (!verdict) throw new Error("logger.run: verdict is required");
            write({ type: "run", ts: new Date().toISOString(), variant, agent, input, verdict, cost, attempts, model, errorDetail, failContent });
            if (echo) console.log(`${[variant, label].filter(Boolean).join(" ")} → ${verdict}`);
        },

        /** Record a free-form note/event (phase boundary, warning, summary line). */
        note: (msg, extra = {}) => {
            write({ type: "note", ts: new Date().toISOString(), msg, ...extra });
            if (echo) console.log(msg);
        },

        /** Read every record back as an array of objects (for the report step). */
        read: () => fs.readFileSync(filePath, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line)),
    };
};
