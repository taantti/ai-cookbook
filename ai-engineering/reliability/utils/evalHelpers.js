import { execSync } from "node:child_process";
import fs from "node:fs";

/**
 * Command prefixes the harness is allowed to run through runExecSyncCommand.
 * Default-deny allowlist: a command not starting with one of these is rejected.
 */
export const ALLOWED_COMMANDS = [
    "git status --porcelain",
    "git checkout --",
    "claude --agent",
];

// --- Command gateway ---

/**
 * Run a shell command, but only if it starts with an allowed prefix.
 * Single gateway for all shell execution in the harness.
 * @param {string} cmd
 * @param {string} [encoding="utf8"]
 * @returns {string} the command's stdout
 * @throws {Error} if cmd is not on the ALLOWED_COMMANDS allowlist
 */
export const runExecSyncCommand = (cmd, encoding = "utf8") => {
    if (!ALLOWED_COMMANDS.some(allowed => cmd.startsWith(allowed))) {
        throw new Error(`Command '${cmd}' is not allowed. See utils/evalHelpers.js: ALLOWED_COMMANDS`);
    }
    return execSync(cmd, { encoding });
};

// --- Workspace ---

/**
 * Abort unless the given dirs are clean in git (no uncommitted changes).
 * Guards the harness from destroying uncommitted work during resets.
 * @param {string[]} dirs - paths to check
 * @param {string} [encoding="utf8"]
 * @returns {string} git status output (empty when clean)
 * @throws {Error} if dirs is empty, or the workspace has uncommitted changes
 */
export const preFlight = (dirs, encoding = "utf8") => {
    if (!dirs || !dirs.length) throw new Error("Param: dirs cannot be empty!");
    const output = runExecSyncCommand("git status --porcelain -- " + dirs.join(" "), encoding);
    if (output.trim().length) {
        throw new Error("Workspace not clean: commit or stash changes in " + dirs.join(", ") + " first.");
    }
    return output;
};

/**
 * Delete a file if it exists (no error when absent).
 * @param {string} filePath
 */
export const removeFile = (filePath) => {
    fs.rmSync(filePath, { force: true });
};

/**
 * Restore a tracked file to its committed state (git checkout).
 * @param {string} filePath
 */
export const resetFile = (filePath) => {
    runExecSyncCommand("git checkout -- " + filePath);
};

/**
 * Reset a workspace: delete untracked files, restore tracked ones.
 * @param {{ delete: string[], reset: string[] }} params
 *   delete: untracked files to remove · reset: tracked files to git-checkout
 */
export const resetWorkspace = (params) => {
    params.delete.forEach(filePath => removeFile(filePath));
    params.reset.forEach(filePath => resetFile(filePath));
};

// --- Agent invocation ---

/**
 * Run a Claude Code agent headlessly and capture the result.
 * @param {string} agentName - agent to run (--agent)
 * @param {string} inputJson - the -p prompt (a JSON string)
 * @returns {{ status: "ok", raw: string } | { status: "error", message: string }}
 *   ok: raw is the CLI's JSON output; error: the run failed (message is why)
 */
export const runAgent = (agentName, inputJson) => {
    const cmd = `claude --agent ${agentName} -p '${inputJson}' ` +
        `--permission-mode dontAsk --allowedTools "Read,Write,Edit" ` +
        `--max-turns 25 --output-format json`;
    try {
        const raw = runExecSyncCommand(cmd);
        return { status: "ok", raw };
    } catch (error) {
        return { status: "error", message: error.message };
    }
};

// --- Grading ---

/**
 * Canonicalise text for comparison: CRLF→LF, strip per-line trailing whitespace,
 * then force exactly one trailing newline (so both sides compare equal).
 * @param {string} text
 * @returns {string}
 */
export const normalize = (text) =>
    text
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\s+$/, "")
        + "\n";

/**
 * Grade one agent run against the expected output.
 * @param {{ status: string, raw?: string, message?: string }} agentResult - from runAgent
 * @param {string} expectedText - the reference the produced file must match
 * @param {string} actualPath - path the agent was expected to write
 * @param {string} [encoding="utf8"]
 * @returns {"PASS"|"FAIL"|"ERROR"} ERROR = run failed or no file; else PASS/FAIL by content
 */
export const grade = (agentResult, expectedText, actualPath, encoding = "utf8") => {
    if (agentResult.status === "error") return "ERROR";
    if (!fs.existsSync(actualPath)) return "ERROR";
    const actualText = fs.readFileSync(actualPath, encoding);
    return normalize(expectedText) === normalize(actualText) ? "PASS" : "FAIL";
};
