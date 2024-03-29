const execlib = require('./exec');
const path = require('path');
const tools = require('./tool');

function getCmdPath() {
    return path.join(__dirname, '..', 'bin', 'gptscript');
}

const optToArg = {
    cache: "--cache=",
    cacheDir: "--cache-dir=",
}

function toArgs(opts) {
    let args = ["--quiet=false"];
    for (const [key, value] of Object.entries(opts)) {
        if (optToArg[key]) {
            args.push(optToArg[key] + value);
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

function streamExecFile(scriptPath, input = "", opts = {}) {
    const args = toArgs(opts);
    return streamRun(args, undefined, scriptPath, input);
}

module.exports = {
    listTools: listTools,
    listModels: listModels,
    exec: exec,
    execFile: execFile,
    streamExec: streamExec,
    streamExecFile: streamExecFile,
    version: version,
    Tool: tools.Tool,
    FreeForm: tools.FreeForm
}