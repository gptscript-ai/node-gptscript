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
const gptScript = require('@gptscript-ai/gptscript');

async function listTools() {
    const tools = await gptScript.listTools();
    console.log(tools);
}
```

### listModels

Lists all the available models, returns a list.

**Usage:**

```javascript
const gptScript = require('@gptscript-ai/gptscript');

async function listModels() {
    let models = [];
    try {
        models = await gptScript.listModels();
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
const gptScript = require('@gptscript-ai/gptscript');

const prompt = `
who was the president of the united states in 1928?
`;

gptScript.exec(prompt).then(response => {
    console.log(response);
}).catch(error => {
    console.error(error);
});
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
const gptScript = require('@gptscript-ai/gptscript');

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
const gptScript = require('@gptscript-ai/gptscript');


const opts = {
    cache: false,
};

const prompt = `
who was the president of the united states in 1928?
`;

async function streamExec() {
    try {
        const { stdout, stderr, promise } = await gptScript.streamExec(prompt, opts);
        if (stdout) {
            stdout.on('data', data => {
                console.log(`system: ${data}`);
            });
        }
        if (stderr) {
            stderr.on('data', data => {
                console.log(`system: ${data}`);
            });
        }
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
const gptScript = require('@gptscript-ai/gptscript');

const opts = {
    cache: false,
};

async function streamExecFile() {
    try {
        const { stdout, stderr, promise } = await gptScript.streamExecFile('./test.gpt', "--testin how high is that there mouse?", opts);
        if (stdout) {
            stdout.on('data', data => {
                console.log(`system: ${data}`);
            });
        }
        if (stderr) {
            stderr.on('data', data => {
                console.log(`system: ${data}`);
            });
        }
        await promise;
    } catch (e) {
        console.error(e);
    }
}
```

## License

Copyright (c) 2024, [Acorn Labs, Inc.](https://www.acorn.io)

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

<http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
