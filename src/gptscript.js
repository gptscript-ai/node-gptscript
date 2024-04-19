const execlib = require('./exec');
const path = require('path');
const tools = require('./tool');

function getCmdPath() {
    if (process.env.GPTSCRIPT_BIN) {
        return process.env.GPTSCRIPT_BIN;
    }
    return path.join(__dirname, '..', 'bin', 'gptscript');
}

const optToArg = {
    cache: "--disable-cache=",
    cacheDir: "--cache-dir=",
}

function toArgs(opts) {
    let args = ["--quiet=false"];
    for (const [key, value] of Object.entries(opts)) {
        if (optToArg[key]) {
            if (key === "cache") {
                args.push(optToArg[key] + !value);
            } else {
                args.push(optToArg[key] + value);
            }
        }
    }
    return args;
}

function getToolString(tool) {
    let toolString;

    if (Array.isArray(tool)) {
        toolString = tool.map(singleTool => {
            if (!(singleTool instanceof tools.Tool || singleTool instanceof tools.FreeForm)) {
                throw new TypeError("Each tool must be an instance of Tool or FreeForm.");
            }
            return singleTool.toString();
        }).join('\n---\n');
    } else {
        if (!(tool instanceof tools.Tool || tool instanceof tools.FreeForm)) {
            throw new TypeError("The tool must be an instance of Tool or FreeForm.");
        }
        toolString = tool.toString();
    }
    return toolString;
}

function cliArgBuilder(args, stdin, gptPath, input) {
    let returnArgs = []
    returnArgs.push(...args);
    // stdin is undefined, and gptpath is a file in the current dir
    if (stdin === undefined && gptPath.endsWith('.gpt')) {
        returnArgs.push(gptPath);
        if (input !== "") {
            returnArgs.push(input);
        }
    } else if (stdin !== undefined) {
        returnArgs.push('-');
    }
    return returnArgs;
}

function run(args = [], stdin, gptPath = './', input = "", env = process.env) {
    const cmdPath = getCmdPath();
    const cmdArgs = cliArgBuilder(args, stdin, gptPath, input);

    return execlib.exec(cmdPath, cmdArgs, stdin, './', false, env);
}

function streamRun(args = [], stdin, gptPath = './', input = "", env = process.env) {
    const cmdPath = getCmdPath();
    const cmdArgs = cliArgBuilder(args, stdin, gptPath, input);

    return execlib.streamExec(cmdPath, cmdArgs, stdin, './', false, env);
}

function streamRunWithEvents(args = [], stdin, gptPath = './', input = "", env = process.env) {
    const cmdPath = getCmdPath();
    const cmdArgs = cliArgBuilder(args, stdin, gptPath, input);

    return execlib.streamExecWithEvents(cmdPath, cmdArgs, stdin, './', env);
}

function listTools() {
    return run(['--list-tools']);
}

function version() {
    return run(['--version']);
}

async function listModels() {
    const models = await run(['--list-models']);
    return models.trim().split('\n');
}

async function exec(tool, opts = {}) {
    const args = toArgs(opts);
    const toolString = getToolString(tool);
    return await run(args, toolString);
}

function execFile(scriptPath, input = "", opts = {}) {
    const args = toArgs(opts);
    return run(args, undefined, scriptPath, input);
}

function streamExec(tool, opts = {}) {
    const args = toArgs(opts);
    const toolString = getToolString(tool);

    return streamRun(args, toolString);
}

function streamExecWithEvents(tool, opts = {}) {
    const args = toArgs(opts);
    const toolString = getToolString(tool);

    return streamRunWithEvents(args, toolString);
}

function streamExecFile(scriptPath, input = "", opts = {}) {
    const args = toArgs(opts);
    return streamRun(args, undefined, scriptPath, input);
}

function streamExecFileWithEvents(scriptPath, input = "", opts = {}) {
    const args = toArgs(opts);

    return streamRunWithEvents(args, undefined, scriptPath, input);
}

module.exports = {
    listTools: listTools,
    listModels: listModels,
    exec: exec,
    execFile: execFile,
    streamExec: streamExec,
    streamExecWithEvents: streamExecWithEvents,
    streamExecFile: streamExecFile,
    streamExecFileWithEvents: streamExecFileWithEvents,
    version: version,
    Tool: tools.Tool,
    FreeForm: tools.FreeForm
}