const execfn = require('./exec');
const path = require('path');

function getCmdPath() {
    return path.join(__dirname, '..', 'bin', 'gptscript');
}

const optToArg = {
    cache: "--cache=",
    cacheDir: "--cache-dir=",
}

function toArgs(opts) {
    let args = [];
    for (const [key, value] of Object.entries(opts)) {
        if (optToArg[key]) {
            args.push(optToArg[key] + value);
        }
    }
    return args;
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

async function run(args = [], stdin, gptPath = './', input = "", env = process.env) {
    try {
        const cmdPath = getCmdPath();
        const cmdArgs = cliArgBuilder(args, stdin, gptPath, input);
        const stdout = await execfn(cmdPath, cmdArgs, stdin, './', false, env);
        return stdout;
    } catch (error) {
        throw error;
    }
}

async function listTools() {
    try {
        const tools = await run(['--list-tools']);
        return tools;
    } catch (error) {
        throw error;
    }
}

async function listModels() {
    try {
        const models = await run(['--list-models']);
        return models.trim().split('\n');
    } catch (error) {
        throw error;
    }
}

async function exec(prompt, opts = {}) {
    const args = toArgs(opts);
    try {
        const res = await run(args, prompt);
        return res;
    } catch (error) {
        throw error;
    }
}

async function execFile(scriptPath, input = "", opts = {}) {
    const args = toArgs(opts);
    try {
        const res = await run(args, undefined, scriptPath, input);
        return res;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    listTools: listTools,
    listModels: listModels,
    exec: exec,
    execFile: execFile,
}