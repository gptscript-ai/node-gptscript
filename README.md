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

To use the module and run gptscripts, you need to first set the `OPENAI_API_KEY` environment variable to your OpenAI API
key. You can also set the `GPTSCRIPT_BIN` environment variable to change the execution of the gptscripts.

To ensure it is working properly, you can run the following command:

```bash
npm exec -c "gptscript https://get.gptscript.ai/echo.gpt --input 'Hello, World!'"
```

You will see "Hello, World!" in the output of the command.

## GPTScript

The GPTScript instance allows the caller to run gptscript files, tools, and other operations (see below). Note that the
intention is that a single instance is all you need for the life of your application, you should call `close()` on the
instance when you are done.

## Global Options

When creating a `GTPScript` instance, you can pass the following global options. These options are also available as
run `Options`. Except `Env`, anything specified as a run option will take precedence over the global
option. Any `env` provided in the run options are appended.

- `APIKey`: Specify an OpenAI API key for authenticating requests
- `BaseURL`: A base URL for an OpenAI compatible API (the default is `https://api.openai.com/v1`)
- `DefaultModel`: The default model to use for chat completion requests
- `DefaultModelProvider`: The default model provider to use for chat completion requests
- `Env`: Replace the system's environment variables with these in the for `KEY=VAL`

## Run Options

These are optional options that can be passed to the various `exec` functions.
None of the options is required, and the defaults will reduce the number of calls made to the Model API.
As noted above, the Global Options are also available to specify here. These options would take precedence.

- `cache`: Enable or disable caching. Default (true).
- `cacheDir`: Specify the cache directory.
- `quiet`: No output logging
- `subTool`: Use tool of this name, not the first tool
- `input`: Input arguments for the tool run
- `workspace`: Directory to use for the workspace, if specified it will not be deleted on exit
- `chatState`: The chat state to continue, or null to start a new chat and return the state
- `confirm`: Prompt before running potentially dangerous commands
- `prompt`: Allow scripts to prompt the user for input
- `env`: Extra environment variables to pass to the script in the form `KEY=VAL`

## Functions

### listModels

Lists all the available models, returns a list.

**Usage:**

```javascript
const gptscript = require('@gptscript-ai/gptscript');

async function listModels() {
    let models = [];
    const g = new gptscript.GPTScript();
    try {
        models = await g.listModels();
    } catch (error) {
        console.error(error);
    }
    g.close();
}
```

### version

Get the first of the current `gptscript` binary being used for the calls.

**Usage:**

```javascript
const gptscript = require('@gptscript-ai/gptscript');

async function version() {
    const g = new gptscript.GPTScript();
    try {
        console.log(await g.version());
    } catch (error) {
        console.error(error);
    }
    g.close();
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

const g = new gptscript.GPTScript();
try {
    const run = await g.evaluate(t);
    console.log(await run.text());
} catch (error) {
    console.error(error);
}
g.close();
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
    const g = new gptscript.GPTScript();
    try {
        const run = await g.run('./hello.gpt', opts);
        console.log(await run.text());
    } catch (e) {
        console.error(e);
    }
    g.close();
}
```

### Getting events during runs

The `Run` object exposes event handlers so callers can access the progress events as the script is running.

The `Run` object exposes these events with their corresponding event type:

Subscribing to `RunEventType.Event` gets you all events.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    disableCache: true,
    input: "--testin how high is that there mouse?"
};

async function streamExecFileWithEvents() {
    const g = new gptscript.GPTScript();
    try {
        const run = await g.run('./test.gpt', opts);

        run.on(gptscript.RunEventType.Event, data => {
            console.log(`event: ${JSON.stringify(data)}`);
        });

        await run.text();
    } catch (e) {
        console.error(e);
    }
    g.close();
}
```

### Confirm

If a gptscript can run commands, you may want to inspect and confirm/deny the command before they are run. This can be
done with the `confirm` method. A user should listen for the `RunEventType.CallConfirm` event.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    disableCache: true,
    input: "--testin how high is that there mouse?",
    confirm: true
};

async function streamExecFileWithEvents() {
    const g = new gptscript.GPTScript();
    try {
        const run = await g.run('./test.gpt', opts);

        run.on(gptscript.RunEventType.CallConfirm, async (data: gptscript.CallFrame) => {
            // data.Tool has the information for the command being run.
            // data.Input has the input for this command

            await g.confirm({
                id: data.id,
                accept: true, // false if the command should not be run
                message: "", // Explain the denial (ignored if accept is true)
            })
        });

        await run.text();
    } catch (e) {
        console.error(e);
    }
    g.close();
}
```

### Prompt

A gptscript may need to prompt the user for information like credentials. A user should listen for
the `RunEventType.Prompt`. Note that if `prompt: true` is not set in the options, then an error will occur if a
gptscript attempts to prompt the user.

```javascript
const gptscript = require('@gptscript-ai/gptscript');

const opts = {
    disableCache: true,
    input: "--testin how high is that there mouse?",
    prompt: true
};

async function streamExecFileWithEvents() {
    const g = new gptscript.GPTScript();
    try {
        const run = await g.run('./test.gpt', opts);

        run.on(gptscript.RunEventType.Prompt, async (data: gptscript.PromptFrame) => {
            // data will have the information for what the gptscript is prompting.

            await g.promptResponse({
                id: data.id,
                // response is a map of fields to values
                responses: {[data.fields[0]]: "Some Value"}
            })
        });

        await run.text();
    } catch (e) {
        console.error(e);
    }
    g.close();
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
    const g = new gptscript.GPTScript();
    let run = await g.evaluate(t, opts);
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

    g.close();

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
