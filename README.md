# node-gptscript

This module provides a set of functions to interact with gptscripts. It allows for executing scripts, listing available
tools and models, and more. The functions are designed to be used in a Node.js environment.

## Installation

To use this module, you need to have Node.js installed on your system. Then, you can install the module via npm:

```bash
npm install @gptscript-ai/gptscript
```

This will install the gptscript binary in the `node_modules/@gptscript-ai/gptscript/bin` directory.

You can opt out of this behavior by setting the `NODE_GPTSCRIPT_SKIP_INSTALL_BINARY=true` environment variable before
running `npm install`.

## Usage

To use the module and run gptscripts, you need to first set the OPENAI_API_KEY environment variable to your OpenAI API
key.

To ensure it is working properly, you can run the following command:

```bash
npm exec -c "gptscript https://get.gptscript.ai/echo.gpt --input 'Hello, World!'"
```

you will see "Hello, World!" in the output of the command.

## Client

There are currently a couple "global" options, and the client helps to manage those. A client without any options is
likely what you want. However, here are the current global options:

- `gptscriptURL`: The URL (including `http(s)://) of an "SDK server" to use instead of the fork/exec model.
- `gptscriptBin`: The path to a `gptscript` binary to use instead of the bundled one.

## Options

These are optional options that can be passed to the various `exec` functions.
None of the options is required, and the defaults will reduce the number of calls made to the Model API.

- `disableCache`: Enable or disable caching, default (true)
- `cacheDir`: Specify the cache directory
- `quiet`: No output logging
- `chdir`: Change current working directory
- `subTool`: Use tool of this name, not the first tool
- `workspace`: Directory to use for the workspace, if specified it will not be deleted on exit

## Functions

### listTools

Lists all the available built-in tools.

**Usage:**

```javascript
const gptscript = require('@gptscript-ai/gptscript');

async function listTools() {
    const client = new gptscript.Client();
    const tools = await client.listTools();
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
        const client = new gptscript.Client();
        models = await client.listModels();
    } catch (error) {
        console.error(error);
    }
}
```

### version

Get the first of the current `gptscript` binary being used for the calls.

**Usage:**

```javascript
const gptscript = require('@gptscript-ai/gptscript');

async function version() {
    try {
        const client = new gptscript.Client();
        console.log(await client.version());
    } catch (error) {
        console.error(error);
    }
}
```

### evaluate

Executes a prompt with optional arguments. The first argument can be a `ToolDef`, an array of `ToolDef`s, or a `string`
representing the contents of a gptscript file.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const t = {
    instructions: "Who was the president of the united states in 1928?"
};

try {
    const client = new gptscript.Client();
    const run = client.evaluate(t);
    console.log(await run.text());
} catch (error) {
    console.error(error);
}
```

### run

Executes a GPT script file with optional input and arguments. The script is relative to the callers source directory.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    disableCache: true,
    input: "--input World"
};

async function execFile() {
    try {
        const client = new gptscript.Client();
        const run = client.run('./hello.gpt', opts);
        console.log(await run.text());
    } catch (e) {
        console.error(e);
    }
}
```

### Getting events during runs

The `Run` object exposes event handlers so callers can access the progress events as the script is running.

The `Run` object exposes these events with their corresponding event type:

| Event type                | Event object      |
|---------------------------|-------------------|
| RunEventType.RunStart     | RunStartFrame     |
| RunEventType.RunFinish    | RunFinishFrame    |
| RunEventType.CallStart    | CallStartFrame    |   
| RunEventType.CallChat     | CallChatFrame     |    
| RunEventType.CallContinue | CallContinueFrame |
| RunEventType.CallProgress | CallProgressFrame | 
| RunEventType.CallFinish   | CallFinishFrame   |   
| RunEventType.Event        | Frame             |             

Subscribing to `RunEventType.Event` gets you all events.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    disableCache: true,
    input: "--testin how high is that there mouse?"
};

async function streamExecFileWithEvents() {
    try {
        const client = new gptscript.Client();
        const run = client.run('./test.gpt', opts);

        run.on(gptscript.RunEventType.Event, data => {
            console.log(`event: ${JSON.stringify(data)}`);
        });

        await run.text();
    } catch (e) {
        console.error(e);
    }
}
```

### Chat support

For tools that support chat, you can use the `nextChat` method on the run object to continue the chat. This method takes
a string representing the next chat message from the user.

If the chat can/should continue, then the `Run`'s state will be `RunState.Continue`. Note that calling `nextChat` on
a `Run` object is an error. Each call to `nextChat` will return a new `Run` instance, so, the call can keep track of the
chat `Run`s, if desired.

Here is an example flow for chat.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    disableCache: true
};

const t = {
    chat: true,
    tools: ["sys.chat.finish"],
    instructions: "You are a chat bot. Don't finish the conversation until I say 'bye'."
};

async function streamExecFileWithEvents() {
    const client = new gptscript.Client();
    let run = client.evaluate(t, opts);
    try {
        // Wait for the initial run to complete.
        await run.text();

        while (run.state === gptscript.RunState.Continue) {
            // ...Get the next input from the user somehow...

            run = run.nextChat(inputFromUser)

            // Get the output from gptscript
            const output = await run.text()

            // Display the output to the user...
        }
    } catch (e) {
        console.error(e);
    }


    // The state here should either be RunState.Finished (on success) or RunState.Error (on error).
    console.log(run.state)
}
```

## Types

### Tool Parameters

| Argument       | Type             | Default     | Description                                                                                                                |
|----------------|------------------|-------------|----------------------------------------------------------------------------------------------------------------------------|
| name           | string           | `""`        | The name of the tool. Optional only on the first tool if there are multiple tools defined.                                 |
| description    | string           | `""`        | A brief description of what the tool does, this is important for explaining to the LLM when it should be used.             |
| tools          | array            | `[]`        | An array of tools that the current tool might depend on or use.                                                            |
| maxTokens      | number/undefined | `undefined` | The maximum number of tokens to be used. Prefer `undefined` for uninitialized or optional values.                          |
| modelName      | string           | `""`        | The model that the tool uses, if applicable.                                                                               |
| cache          | boolean          | `true`      | Whether caching is enabled for the tool.                                                                                   |
| temperature    | number/undefined | `undefined` | The temperature setting for the model, affecting randomness. `undefined` for default behavior.                             |
| args           | object           | `{}`        | Additional arguments specific to the tool, described by OpenAPIv3 spec.                                                    |
| internalPrompt | boolean          | `false`     | An internal prompt used by the tool, if any.                                                                               |
| instructions   | string           | `""`        | Instructions on how to use the tool.                                                                                       |
| jsonResponse   | boolean          | `false`     | Whether the tool returns a JSON response instead of plain text. You must include the word 'json' in the body of the prompt |
| export         | string[]         | []          | A list of tools exported by this tool                                                                                      |

## License

Copyright (c) 2024, [Acorn Labs, Inc.](https://www.acorn.io)

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the
License. You may obtain a copy of the License at

<http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "
AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific
language governing permissions and limitations under the License.
