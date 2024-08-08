import * as gptscript from "../src/gptscript"
import {ArgumentSchemaType, getEnv, PropertyType, RunEventType, ToolType} from "../src/gptscript"
import path from "path"
import {fileURLToPath} from "url"

let g: gptscript.GPTScript
const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe("gptscript module", () => {
    beforeAll(async () => {
        if (!process.env.OPENAI_API_KEY && !process.env.GPTSCRIPT_URL) {
            throw new Error("neither OPENAI_API_KEY nor GPTSCRIPT_URL is set")
        }

        g = new gptscript.GPTScript({APIKey: process.env.OPENAI_API_KEY})
    })
    afterAll(() => {
        g.close()
    })

    test("creating an closing another instance should work", async () => {
        const other = new gptscript.GPTScript()
        await other.version()
        other.close()
    })

    test("listTools returns available tools", async () => {
        const tools = await g.listTools()
        expect(tools).toBeDefined()
    })

    test("listModels returns a list of models", async () => {
        // Similar structure to listTools
        let models = await g.listModels()
        expect(models).toBeDefined()
    })

    test("version returns a gptscript version", async () => {
        // Similar structure to listTools
        let version = await g.version()
        expect(version).toContain("gptscript version")
    })

    test("evaluate executes a prompt correctly", async () => {
        const t = {
            instructions: "who was the president of the united states in 1928?"
        }

        const run = await g.evaluate(t)
        expect(run).toBeDefined()
        expect(await run.text()).toContain("Calvin Coolidge")
    })

    test("evaluate executes and streams a prompt correctly", async () => {
        let out = ""
        let err = undefined
        const t = {
            instructions: "who was the president of the united states in 1928?"
        }
        const opts = {
            disableCache: true,
        }

        const run = await g.evaluate(t, opts)
        run.on(gptscript.RunEventType.CallProgress, (data: gptscript.CallFrame) => {
            for (let output of data.output) out += `system: ${output.content}`
        })

        let callFinished = false
        run.on(gptscript.RunEventType.CallFinish, (data: gptscript.CallFrame) => {
            if (data.type == RunEventType.CallFinish) {
                expect(callFinished).toBe(false)
                callFinished = true
            }
        })

        await run.text()
        err = run.err

        expect(out).toContain("Calvin Coolidge")
        expect(err).toEqual("")
        expect(run.parentCallFrame()).toBeTruthy()
    })

    test("evaluate executes a prompt correctly with context", async () => {
        let out = ""
        let err = undefined
        const t = {
            instructions: "who was the president of the united states in 1928?",
            context: [path.join(__dirname, "fixtures", "acorn-labs-context.gpt")]
        }

        const run = await g.evaluate(t, {disableCache: true})
        out = await run.text()
        err = run.err

        expect(out).toContain("Acorn Labs")
        expect(err).toEqual("")
    })

    test("should execute test.gpt correctly", async () => {
        const testGptPath = path.join(__dirname, "fixtures", "test.gpt")

        const result = await (await g.run(testGptPath)).text()
        expect(result).toBeDefined()
        expect(result).toContain("Calvin Coolidge")
    })

    test("should override credentials correctly", async () => {
        let testGptPath = path.join(__dirname, "fixtures", "credential-override.gpt")
        if (process.platform === "win32") {
            testGptPath = path.join(__dirname, "fixtures", "credential-override-windows.gpt")
        }

        const result = await (await g.run(testGptPath, {
            disableCache: true,
            credentialOverrides: ["test.ts.credential_override:TEST_CRED=foo"],
        })).text()

        expect(result).toBeDefined()
        expect(result).toContain("foo")
    })

    test("run executes and stream a file correctly", async () => {
        let out = ""
        let err = undefined
        const testGptPath = path.join(__dirname, "fixtures", "test.gpt")
        const opts = {
            disableCache: true,
        }

        const run = await g.run(testGptPath, opts)
        run.on(gptscript.RunEventType.CallProgress, data => {
            for (let output of data.output) out += `system: ${output.content}`
        })
        await run.text()
        err = run.err

        expect(out).toContain("Calvin Coolidge")
        expect(err).toEqual("")
    })

    test("run executes and streams a file with global tools correctly", async () => {
        let out = ""
        let err = undefined
        const testGptPath = path.join(__dirname, "fixtures", "global-tools.gpt")
        const opts = {
            disableCache: true,
        }

        const run = await g.run(testGptPath, opts)
        run.on(gptscript.RunEventType.CallProgress, data => {
            for (let output of data.output) out += `system: ${output.content}`
        })
        await run.text()
        err = run.err

        expect(out).toContain("Hello!")
        expect(err).toEqual("")
    }, 15000)

    test("aborting a run is reported correctly", async () => {
        let errMessage = ""
        let err = undefined
        const testGptPath = path.join(__dirname, "fixtures", "test.gpt")
        const opts = {
            disableCache: true,
        }

        try {
            const run = await g.run(testGptPath, opts)
            run.on(gptscript.RunEventType.CallProgress, data => {
                run.close()
            })
            await run.text()
            err = run.err
        } catch (error: any) {
            errMessage = error
        }

        expect(errMessage).toContain("aborted")
        expect(err).toBeUndefined()
    })


    describe("evaluate with multiple tools", () => {
        test("multiple tools", async () => {
            const t0 = {
                tools: ["ask"],
                instructions: "Only use the ask tool to ask who was the president of the united states in 1928?"
            }
            const t1 = {
                name: "ask",
                description: "This tool is used to ask a question",
                arguments: {
                    type: ArgumentSchemaType,
                    properties: {
                        question: {
                            type: PropertyType,
                            description: "The question to ask",
                        }
                    }
                },
                instructions: "${question}"
            }

            const response = await (await g.evaluate([t0, t1])).text()
            expect(response).toBeDefined()
            expect(response).toContain("Calvin Coolidge")
        }, 30000)

        test("with sub tool", async () => {
            const t0 = {
                tools: ["ask"],
                instructions: "Only use the ask tool to ask who was the president of the united states in 1928?"
            }
            const t1 = {
                name: "other",
                instructions: "Who was the president of the united states in 1986?"
            }
            const t2 = {
                name: "ask",
                description: "This tool is used to ask a question",
                arguments: {
                    type: "object",
                    question: "The question to ask"
                },
                instructions: "${question}"
            }

            const response = await (await g.evaluate([t0, t1, t2], {subTool: "other"})).text()
            expect(response).toBeDefined()
            expect(response).toContain("Ronald Reagan")
        }, 30000)
    })

    test("parse file", async () => {
        const response = await g.parse(path.join(__dirname, "fixtures", "test.gpt"))
        expect(response).toBeDefined()
        expect(response).toHaveLength(1)
        expect((response[0] as gptscript.Tool).instructions).toEqual("who was the president in 1928?")
    }, 30000)

    test("parse file with metadata", async () => {
        const response = await g.parse(path.join(__dirname, "fixtures", "parse-with-metadata.gpt"))
        expect(response).toBeDefined()
        expect(response).toHaveLength(2)
        expect((response[0] as gptscript.Tool).instructions).toContain("requests.get")
        expect((response[0] as gptscript.Tool).metaData).toEqual({"requirements.txt": "requests"})
        expect((response[1] as gptscript.Text).format).toEqual("metadata:foo:requirements.txt")
    }, 30000)

    test("parse string tool", async () => {
        const tool = "How much wood would a woodchuck chuck if a woodchuck could chuck wood?"
        const response = await g.parseTool(tool)
        expect(response).toBeDefined()
        expect(response).toHaveLength(1)
        expect((response[0] as gptscript.Tool).instructions).toEqual(tool)
    }, 30000)

    test("parse string tool with text node", async () => {
        const tool = "How much wood would a woodchuck chuck if a woodchuck could chuck wood?\n---\n!markdown\nThis is a text node"
        const response = await g.parseTool(tool)
        expect(response).toBeDefined()
        expect(response).toHaveLength(2)
        expect((response[0] as gptscript.Tool).instructions).toEqual("How much wood would a woodchuck chuck if a woodchuck could chuck wood?")
        expect((response[1] as gptscript.Text).content).toEqual("This is a text node")
    }, 30000)

    test("parse string tool global tools", async () => {
        const tool = "Global Tools: acorn, do-work\nHow much wood would a woodchuck chuck if a woodchuck could chuck wood?"
        const response = await g.parseTool(tool)
        expect(response).toBeDefined()
        expect(response).toHaveLength(1)
        expect((response[0] as gptscript.Tool).instructions).toEqual("How much wood would a woodchuck chuck if a woodchuck could chuck wood?")
        expect((response[0] as gptscript.Tool).globalTools).toEqual(["acorn", "do-work"])
    }, 30000)

    test("parse string tool first line shebang", async () => {
        const tool = "\n#!/usr/bin/env python\nHow much wood would a woodchuck chuck if a woodchuck could chuck wood?"
        const response = await g.parseTool(tool)
        expect(response).toBeDefined()
        expect(response).toHaveLength(1)
        expect((response[0] as gptscript.Tool).instructions).toEqual("#!/usr/bin/env python\nHow much wood would a woodchuck chuck if a woodchuck could chuck wood?")
    }, 30000)

    test("format tool", async () => {
        const tool = {
            id: "my-tool",
            type: ToolType,
            tools: ["sys.write", "sys.read"],
            instructions: "This is a test",
            arguments: {
                type: ArgumentSchemaType,
                properties: {
                    text: {
                        type: PropertyType,
                        description: "The text to write"
                    }
                }
            }
        }

        const response = await g.stringify([tool])
        expect(response).toBeDefined()
        expect(response).toContain("Tools: sys.write, sys.read")
        expect(response).toContain("This is a test")
        expect(response).toContain("Parameter: text: The text to write")
    })

    test("exec tool with chat", async () => {
        let err = undefined
        const t = {
            chat: true,
            instructions: "You are a chat bot. Don't finish the conversation until I say 'bye'.",
            tools: ["sys.chat.finish"]
        }
        const opts = {
            disableCache: true,
        }
        let run = await g.evaluate(t, opts)

        const inputs = [
            "List the three largest states in the United States by area.",
            "What is the capital of the third one?",
            "What timezone is the first one in?"
        ]

        const expectedOutputs = [
            "California",
            "Sacramento",
            "Alaska Time Zone"
        ]

        await run.text()
        for (let i: number = 0; i < inputs.length; i++) {
            run = run.nextChat(inputs[i])
            err = run.err

            if (err) {
                break
            }

            expect(await run.text()).toContain(expectedOutputs[i])
            expect(run.state).toEqual(gptscript.RunState.Continue)
        }

        run = run.nextChat("bye")
        await run.text()

        expect(run.state).toEqual(gptscript.RunState.Finished)
        expect(err).toEqual("")
    }, 60000)

    test("exec file with chat", async () => {
        let err = undefined
        const opts = {
            disableCache: true
        }
        let run = await g.run(path.join(__dirname, "fixtures", "chat.gpt"), opts)

        const inputs = [
            "List the 3 largest of the Great Lakes by volume.",
            "What is the volume of the second in the list in cubic miles?",
            "What is the total area of the third in the list in square miles?"
        ]

        const expectedOutputs = [
            "Lake Superior",
            "Lake Michigan",
            "Lake Huron"
        ]

        await run.text()
        for (let i: number = 0; i < inputs.length; i++) {
            run = run.nextChat(inputs[i])
            err = run.err

            if (err) {
                break
            }

            expect(await run.text()).toContain(expectedOutputs[i])
            expect(run.state).toEqual(gptscript.RunState.Continue)
        }

        run = run.nextChat("bye")
        await run.text()

        expect(run.state).toEqual(gptscript.RunState.Finished)
        expect(err).toEqual("")
    }, 60000)

    test("nextChat on file providing chat state", async () => {
        let run = await g.run(path.join(__dirname, "fixtures", "chat.gpt"), {disableCache: true})

        run = run.nextChat("List the 3 largest of the Great Lakes by volume.")
        expect(await run.text()).toContain("Lake Superior")
        expect(run.err).toEqual("")
        expect(run.state).toEqual(gptscript.RunState.Continue)

        run = await g.run(path.join(__dirname, "fixtures", "chat.gpt"), {
            disableCache: true,
            input: "What is the total area of the third one in square miles?",
            chatState: run.currentChatState()
        })

        expect(await run.text()).toContain("Lake Huron")
        expect(run.err).toEqual("")
        expect(run.state).toEqual(gptscript.RunState.Continue)
    }, 10000)

    test("nextChat on tool providing chat state", async () => {
        const t = {
            chat: true,
            instructions: "You are a chat bot. Don't finish the conversation until I say 'bye'.",
            tools: ["sys.chat.finish"]
        }
        let run = await g.evaluate(t, {disableCache: true})

        run = run.nextChat("List the three largest states in the United States by area.")
        expect(await run.text()).toContain("California")
        expect(run.err).toEqual("")
        expect(run.state).toEqual(gptscript.RunState.Continue)

        run = await g.evaluate(t, {
            disableCache: true,
            input: "What is the capital of the second one?",
            chatState: run.currentChatState()
        })

        expect(await run.text()).toContain("Austin")
        expect(run.err).toEqual("")
        expect(run.state).toEqual(gptscript.RunState.Continue)
    }, 10000)

    test("confirm", async () => {
        const t = {
            instructions: "List the files in the current working directory.",
            tools: ["sys.exec"]
        }

        const commands = [`"ls"`, `"dir"`]
        let confirmCallCount = 0
        const run = await g.evaluate(t, {confirm: true})
        run.on(gptscript.RunEventType.CallConfirm, async (data: gptscript.CallFrame) => {
            // On Windows, ls is not always a command. The LLM will try to run dir in this case. Allow both.
            expect(data.input).toContain(commands[confirmCallCount])
            confirmCallCount++
            await g.confirm({id: data.id, accept: true})
        })

        expect(await run.text()).toContain("README.md")
        expect(run.err).toEqual("")
        expect(confirmCallCount > 0).toBeTruthy()
    })

    test("do not confirm", async () => {
        let confirmFound = false
        const t = {
            instructions: "List the files in the current directory as '.'. If that doesn't work print the word FAIL.",
            tools: ["sys.exec"]
        }
        const run = await g.evaluate(t, {confirm: true})
        run.on(gptscript.RunEventType.CallConfirm, async (data: gptscript.CallFrame) => {
            expect(data.input).toContain(`"ls"`)
            confirmFound = true
            await g.confirm({id: data.id, accept: false, message: "I will not allow it!"})
        })

        expect(await run.text()).toContain("FAIL")
        expect(run.err).toEqual("")
        expect(confirmFound).toBeTruthy()
    })

    test("prompt", async () => {
        let promptFound = false
        const t = {
            instructions: "Use the sys.prompt user to ask the user for 'first name' which is not sensitive. After you get their first name, say hello.",
            tools: ["sys.prompt"]
        }
        const run = await g.evaluate(t, {prompt: true})
        run.on(gptscript.RunEventType.Prompt, async (data: gptscript.PromptFrame) => {
            expect(data.message).toContain("first name")
            expect(data.fields.length).toEqual(1)
            expect(data.fields[0]).toEqual("first name")
            expect(data.sensitive).toBeFalsy()

            promptFound = true
            await g.promptResponse({id: data.id, responses: {[data.fields[0]]: "Clicky"}})
        })

        expect(await run.text()).toContain("Clicky")
        expect(run.err).toEqual("")
        expect(promptFound).toBeTruthy()
    })

    test("prompt without prompt allowed should fail", async () => {
        let promptFound = false
        const t = {
            instructions: "Use the sys.prompt user to ask the user for 'first name' which is not sensitive. After you get their first name, say hello.",
            tools: ["sys.prompt"]
        }
        const run = await g.evaluate(t)
        run.on(gptscript.RunEventType.Prompt, async (data: gptscript.PromptFrame) => {
            promptFound = true
        })

        try {
            await run.text()
        } catch (e) {
            expect(e).toContain("prompt occurred")
        }
        expect(run.err).toContain("prompt occurred")
        expect(promptFound).toBeFalsy()
    })

    test("retry failed run", async () => {
        let shebang = `#!/bin/bash\nexit \${EXIT_CODE}`
        if (process.platform == "win32") {
            shebang = "#!/usr/bin/env powershell.exe\n$e = $env:EXIT_CODE;\nif ($e) { Exit 1; }"
        }
        const t = {
            instructions: "say hello",
            context: ["my-context"]
        } as gptscript.ToolDef
        const contextTool = {
            name: "my-context",
            instructions: `${shebang}\nexit \${EXIT_CODE}`
        } as gptscript.ToolDef

        let run = await g.evaluate([t, contextTool], {disableCache: true, env: ["EXIT_CODE=1"]})
        try {
            await run.text()
        } catch {
        }

        expect(run.err).not.toEqual("")

        run.opts.env = []
        run = run.nextChat()

        await run.text()

        expect(run.err).toEqual("")
    })

    test("test get_env default", async () => {
        const env = getEnv("TEST_ENV_MISSING", "foo")
        expect(env).toEqual("foo")
    })

    test("test get_env", async () => {
        process.env.TEST_ENV = "{\"_gz\":\"H4sIAEosrGYC/ytJLS5RKEvMKU0FACtB3ewKAAAA\"}"
        const env = getEnv("TEST_ENV", "missing")
        expect(env).toEqual("test value")
    })

    test("run file with metadata", async () => {
        let err = undefined
        let out = ""
        let run = await g.run(path.join(__dirname, "fixtures", "parse-with-metadata.gpt"))

        try {
            out = await run.text()
        } catch (e) {
            err = e
        }
        expect(err).toEqual(undefined)
        expect(out).toEqual("200")
    }, 20000)

    test("run parsed tool with metadata", async () => {
        let err = undefined
        let out = ""
        let tools = await g.parse(path.join(__dirname, "fixtures", "parse-with-metadata.gpt"))

        let run = await g.evaluate(tools[0])

        try {
            out = await run.text()
        } catch (e) {
            err = e
        }
        expect(err).toEqual(undefined)
        expect(out).toEqual("200")
    }, 20000)
})