const execlib = require('./exec');
const reqlib = require('./request');
const tools = require('./tool');
const path = require('path');

function getCmdPath() {
    if (process.env.GPTSCRIPT_BIN) {
        return process.env.GPTSCRIPT_BIN;
    }
    return path.join(__dirname, '..', 'bin', 'gptscript');
}

const optToArg = {
    disableCache: "--disable-cache=",
    cacheDir: "--cache-dir=",
    quiet: "--quiet=",
    chdir: "--chdir=",
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
        toolString = toolArrayToContents(tool);
    } else {
        if (!(tool instanceof tools.Tool || tool instanceof tools.FreeForm)) {
            throw new TypeError("The tool must be an instance of Tool or FreeForm.");
        }
        toolString = tool.toString();
    }
    return toolString;
}

function toolArrayToContents(toolArray) {
    return toolArray.map(singleTool => {
        if (!(singleTool instanceof tools.Tool || singleTool instanceof tools.FreeForm)) {
            throw new TypeError("Each tool must be an instance of Tool or FreeForm.");
        }
        return singleTool.toString();
    }).join('\n---\n');
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

async function listTools() {
    if (process.env['GPTSCRIPT_URL']) {
        return await reqlib.makeRequest('list-tools');
    }
    return await run(['--list-tools']);
}

async function version() {
    if (process.env['GPTSCRIPT_URL']) {
        return await reqlib.makeRequest('version');
    }
    return await run(['--version']);
}

async function listModels() {
    if (process.env['GPTSCRIPT_URL']) {
        return await reqlib.makeRequest('list-models');
    }
    const models = await run(['--list-models']);
    return models.trim().split('\n');
}

async function exec(tool, opts = {}) {
    if (process.env['GPTSCRIPT_URL']) {
        if (Array.isArray(tool)) {
            return await reqlib.makeRequest('run-tool', {content: toolArrayToContents(tool)}, opts);
        }
        return await reqlib.makeRequest('run-tool', tool, opts);
    }

    const args = toArgs(opts);
    const toolString = getToolString(tool);
    return await run(args, toolString);
}

async function execFile(scriptPath, input = "", opts = {}) {
    if (process.env['GPTSCRIPT_URL']) {
        return await reqlib.makeRequest('run-file', {file: scriptPath, input: input}, opts);
    }
    const args = toArgs(opts);
    return await run(args, undefined, scriptPath, input);
}

function streamExec(tool, opts = {}) {
    if (process.env['GPTSCRIPT_URL']) {
        if (Array.isArray(tool)) {
            return reqlib.makeRequest('run-tool', {content: toolArrayToContents(tool)}, opts);
        }
        return reqlib.makeStreamRequest('run-tool-stream', tool, opts);
    }

    const args = toArgs(opts);
    const toolString = getToolString(tool);

    return streamRun(args, toolString);
}

function streamExecWithEvents(tool, opts = {}) {
    if (process.env['GPTSCRIPT_URL']) {
        if (Array.isArray(tool)) {
            return reqlib.makeRequest('run-tool', {content: toolArrayToContents(tool)}, opts);
        }
        return reqlib.makeStreamRequestWithEvents('run-tool-stream-with-events', tool, opts);
    }

    const args = toArgs(opts);
    const toolString = getToolString(tool);

    return streamRunWithEvents(args, toolString);
}

function streamExecFile(scriptPath, input = "", opts = {}) {
    if (process.env['GPTSCRIPT_URL']) {
        return reqlib.makeStreamRequest('run-file-stream', {file: scriptPath, input: input}, opts);
    }

    const args = toArgs(opts);
    return streamRun(args, undefined, scriptPath, input);
}

function streamExecFileWithEvents(scriptPath, input = "", opts = {}) {
    if (process.env['GPTSCRIPT_URL']) {
        return reqlib.makeStreamRequestWithEvents('run-file-stream-with-events', {file: scriptPath, input: input}, opts);
    }

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