import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path"
import { homedir } from "node:os";

/**
 * Command prefixes the harness is allowed to run through runExecSyncCommand.
 * Default-deny allowlist: a command not starting with one of these is rejected.
 */
export const ALLOWED_COMMANDS = [
    "git status --porcelain",
    "git checkout --",
    "claude --agent",
    "claude --version",
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

/**
 * Report the installed Claude CLI version (for run-metadata logging).
 * @returns {string} e.g. "2.1.216 (Claude Code)"
 */
export const getCliVersion = () => runExecSyncCommand("claude --version").trim();

/**
 * Detect and remove a "ghost twin" of a repo-relative path at the filesystem
 * root (on Windows: the current drive's root, e.g. C:\tests\...). Agents
 * occasionally emit POSIX-rooted paths like /tests/...; a Write through such a
 * path creates a stale file that poisons later runs — the agent's existence
 * check finds it and stops, producing systematic ERRORs.
 * @param {string} relPath - repo-relative path, e.g. "tests/setup/mockData/foo.js"
 * @returns {boolean} true if a ghost existed (it has been removed)
 */
export const removeGhostTwin = (relPath) => {
    const ghost = "/" + relPath;
    if (!fs.existsSync(ghost)) return false;
    fs.rmSync(ghost, { force: true });
    return true;
};

// --- Paths ---

/**
 * True when a path matches any rooted-path condition: at a given position
 * the path starts with one of the listed prefixes. Defaults: "/" or "\"
 * at 0, ":" at 1 (drive letter).
 * @param {string} filePath - the path as written in a tool call
 * @param {Object<string, string[]>} [rootedPathConditions] - position → accepted prefixes
 * @returns {boolean}
 */
export const isRootedPath = (filePath, rootedPathConditions = { 0: ["/", "\\"], 1: [":"] }) => {
    for (const [position, prefixes] of Object.entries(rootedPathConditions)) {
        if (prefixes.some(prefix => filePath.startsWith(prefix, Number(position)))) return true;
    }
    return false;
};

// --- Agent invocation ---

/**
 * Run a Claude Code agent headlessly and capture the result.
 * Write/Edit are path-scoped to the mock-data dir (hardening, 2026-08-03):
 * the model occasionally emits POSIX-rooted paths (/tests/...), which Windows
 * resolves to the drive root — an unscoped Write then lands outside the repo
 * unnoticed. Scoped rules turn those into logged permission_denials instead.
 * @param {string} agentName - agent to run (--agent)
 * @param {string} inputJson - the -p prompt (a JSON string)
 * @param {string|null} [sessionId=null] - if given, passed as --session-id so the run's transcript lands at a known path
 * @returns {{ status: "ok", raw: string } | { status: "error", message: string }}
 *   ok: raw is the CLI's JSON output; error: the run failed (message is why)
 */
export const runAgent = (agentName, inputJson, sessionId = null) => {
    const cmd = `claude --agent ${agentName} -p '${inputJson}' ` +
        `--permission-mode dontAsk ` +
        `--allowedTools "Read,Write(tests/setup/mockData/**),Edit(tests/setup/mockData/**)" ` +
        `--max-turns 25 --output-format json` +
        (sessionId ? ` --session-id ${sessionId}` : "");
    try {
        const raw = runExecSyncCommand(cmd);
        return { status: "ok", raw };
    } catch (error) {
        return { status: "error", message: error.message };
    }
};

// --- Transcript ---

/**
 * Find transcript with session id
 * @param {string} sessionId 
 * @returns {string|null} Transcript path or null if not found or sessionId missing
 */
export const findTranscript = (sessionId) => {
    if (!sessionId) return null;
    const root = path.join(homedir(), ".claude", "projects");
    const dirObjects = fs.readdirSync(root);

    for (const dirObject of dirObjects) {
        const dirObjectPath = path.join(root, dirObject, sessionId + ".jsonl");
        if (fs.existsSync(dirObjectPath)) return dirObjectPath;
    }

    return null;
};

/**
 * Load and parse one specific log file (JSONL → data).
 * @param {string} filePath
 * @returns {{ object[] }}
 */
export const readJsonl = (filePath) => {
    const data = fs.readFileSync(filePath, "utf8")
        .trim().split("\n").filter(Boolean)
        .map(line => JSON.parse(line));
    return data;
};
/** 
 * @param {object} line - content of single line
 * @param {string} eventType
 * @param {string} blockType
 * @returns {object[]} matching line blocks
 */
const lineContentBlocks = (line, eventType, blockType) => {
    const lineBlocks = [];
    if (line.type !== eventType) return [];
    const lineContent = line.message?.content;
    if (!Array.isArray(lineContent)) return [];
    for (const lineBlock of lineContent) {
        if (lineBlock.type !== blockType) continue;
        lineBlocks.push(lineBlock);
    }
    return lineBlocks;

};

/**
 * Select content blocks of one type from transcript events of one type.
 * @param {object[]} data - one object per transcript line
 * @param {string} [eventType="assistant"]
 * @param {string} [blockType="tool_use"]
 * @returns {object[]} matching blocks, in transcript order
 */
export const filterContentBlocks = (data, eventType = "assistant", blockType = "tool_use") => {
    const blocks = [];
    switch (eventType) {
        case "assistant":
        case "user": {
            for (const line of data) {
                const lineBlocks = lineContentBlocks(line, eventType, blockType);
                blocks.push(...lineBlocks);
            }
            break;
        }
        default: break;
    }
    return blocks;
};

/**
 * Collect one input value from every content block that matches the given
 * block type and tool name. Blocks whose input lacks the key, or whose value
 * is not a string, are skipped.
 * @param {object[]} blocks - content blocks
 * @param {string} [blockType="tool_use"] - block type to accept
 * @param {string[]} [blockNames=["Read","Write","Edit"]] - tool names to accept
 * @param {string} [blockInputKey="file_path"] - key to read from block.input
 * @returns {string[]} the values, in block order
 */
export const blockInputValues = (blocks, blockType = "tool_use", blockNames = ["Read", "Write", "Edit"], blockInputKey = "file_path") => {
    const values = [];
    for (const block of blocks) {
        if (block.type !== blockType || !blockNames.includes(block.name)) continue;
        if (typeof block.input?.[blockInputKey] !== "string") continue;
        values.push(block.input[blockInputKey]);
    }
    return values;

};

/**
 * Read a JSONL transcript and return input values of the blocks that match:
 * events of eventType, blocks of blockType whose name is in blockNames,
 * value read from block.input[blockInputKey] (strings only).
 * @param {string|null} transcriptPath - empty or missing path returns []
 * @param {object} [options]
 * @param {string} [options.eventType="assistant"] - event type to look in
 * @param {string} [options.blockType="tool_use"] - block type to accept
 * @param {string[]} [options.blockNames=["Read","Write","Edit"]] - block names to accept
 * @param {string} [options.blockInputKey="file_path"] - key read from block.input
 * @returns {string[]} the values, in transcript order
 */
export const transcriptInputValues = (
    transcriptPath,
    {
        eventType = "assistant",
        blockType = "tool_use",
        blockNames = ["Read", "Write", "Edit"],
        blockInputKey = "file_path"
    } = {}
) => {
    if (!transcriptPath) return [];

    const transcript = readJsonl(transcriptPath);

    const blocks = filterContentBlocks(transcript, eventType, blockType);
    return blockInputValues(blocks, blockType, blockNames, blockInputKey);
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
