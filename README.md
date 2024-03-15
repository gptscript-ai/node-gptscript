# node-gptscript

This module provides a set of functions to interact with gptscripts. It allows for executing scripts, listing available tools and models, and more. The functions are designed to be used in a Node.js environment.

## Installation

To use this module, you need to have Node.js installed on your system. Then, you can install the module via npm:

```bash
npm install @gptscript-ai/gptscript
```

This will install the gptscript binary in the `node_modules/@gptscript-ai/gptscript/bin` directory.

You can opt out of this behavior by setting the `NODE_GPTSCRIPT_SKIP_INSTALL_BINARY=true` environment variable before running `npm install`.

## Usage

To use the module and run gptscripts, you need to first set the OPENAI_API_KEY environment variable to your OpenAI API key.

To ensure it is working properly, you can run the following command:

```bash
npm exec -c "gptscript https://get.gptscript.ai/echo.gpt --input 'Hello, World!'"
```

you will see "Hello, World!" in the output of the command.

## Functions

### listTools

Lists all the available built-in tools.

**Usage:**

```javascript
const gptscript = require('@gptscript-ai/gptscript');

async function listTools() {
    const tools = await gptscript.listTools();
    console.log(tools);
}
```

### listModels

Lists all the available models, returns a list.

**Usage:**

```javascript
const gptscript = require('@gptscript-ai/gptscript');

async function listModels() {
    let models = [];
    try {
        models = await gptscript.listModels();
    } catch (error) {
        console.error(error);
    }
}
```

### exec

Executes a prompt with optional arguments.

**Options:**

These are optional options that can be passed to the `exec` function.
Neither option is required, and the defaults will reduce the number of calls made to the Model API.

- `cache`: Enable or disable caching. Default (true).
- `cacheDir`: Specify the cache directory.

**Usage:**

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const t = new gptscript.Tool({
    instructions: "who was the president of the united states in 1928?"
});

try {
    const response = await gptscript.exec(t);
    console.log(response);
} catch (error) {
    console.error(error);
}
```

### execFile

Executes a GPT script file with optional input and arguments.

**Options:**

These are optional options that can be passed to the `exec` function.
Neither option is required, and the defaults will reduce the number of calls made to the Model API.

- `cache`: Enable or disable caching.
- `cacheDir`: Specify the cache directory.

**Usage:**

The script is relative to the callers source directory.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    cache: false,
};

async function execFile() {
    try {
        const out = await foo.execFile('./hello.gpt', "--input World", opts);
        console.log(out);
    } catch (e) {
        console.error(e);
    }
}
```

### streamExec

Executes a gptscript with optional input and arguments, and returns the output streams.

**Options:**

These are optional options that can be passed to the `exec` function.
Neither option is required, and the defaults will reduce the number of calls made to the Model API.

- `cache`: Enable or disable caching.
- `cacheDir`: Specify the cache directory.

**Usage:**

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    cache: false,
};

const t = new gptscript.Tool({
    instructions: "who was the president of the united states in 1928?"
});

async function streamExec() {
    try {
        const { stdout, stderr, promise } = await gptscript.streamExec(prompt, opts);

        stdout.on('data', data => {
            console.log(`system: ${data}`);
        });

        stderr.on('data', data => {
            console.log(`system: ${data}`);
        });

        await promise;
    } catch (e) {
        console.error(e);
    }
}
```

### streamExecFile

**Options:**

These are optional options that can be passed to the `exec` function.
Neither option is required, and the defaults will reduce the number of calls made to the Model API.

- `cache`: Enable or disable caching.
- `cacheDir`: Specify the cache directory.

**Usage:**

The script is relative to the callers source directory.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    cache: false,
};

async function streamExecFile() {
    try {
        const { stdout, stderr, promise } = await gptscript.streamExecFile('./test.gpt', "--testin how high is that there mouse?", opts);

        stdout.on('data', data => {
            console.log(`system: ${data}`);
        });

        stderr.on('data', data => {
            console.log(`system: ${data}`);
        });

        await promise;
    } catch (e) {
        console.error(e);
    }
}
```

## Types

### Tool Parameters

| Argument          | Type           | Default     | Description                                                                                   |
|-------------------|----------------|-------------|-----------------------------------------------------------------------------------------------|
| name              | string         | `""`        | The name of the tool. Optional only on the first tool if there are multiple tools defined.                                                                         |
| description       | string         | `""`        | A brief description of what the tool does, this is important for explaining to the LLM when it should be used.                                                    |
| tools             | array          | `[]`        | An array of tools that the current tool might depend on or use.                               |
| maxTokens         | number/undefined | `undefined` | The maximum number of tokens to be used. Prefer `undefined` for uninitialized or optional values. |
| model             | string         | `""`        | The model that the tool uses, if applicable.                                                  |
| cache             | boolean        | `true`      | Whether caching is enabled for the tool.                                                      |
| temperature       | number/undefined | `undefined` | The temperature setting for the model, affecting randomness. `undefined` for default behavior. |
| args              | object         | `{}`        | Additional arguments specific to the tool, described by key-value pairs.                      |
| internalPrompt    | string         | `""`        | An internal prompt used by the tool, if any.                                                  |
| instructions      | string         | `""`        | Instructions on how to use the tool.                                                          |
| jsonResponse      | boolean        | `false`     | Whether the tool returns a JSON response instead of plain text. You must include the word 'json' in the body of the prompt                               |

### FreeForm Parameters

| Argument  | Type   | Default | Description                           |
|-----------|--------|---------|---------------------------------------|
| content   | string | `""`    | This is a multi-line string that contains the  entire contents of a valid gptscript file|

## License

Copyright (c) 2024, [Acorn Labs, Inc.](https://www.acorn.io)

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

<http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
