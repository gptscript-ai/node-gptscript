import http from "http"
import path from "path"
import child_process from "child_process"
import {fileURLToPath} from "url"
import {gunzipSync} from "zlib"

export interface GlobalOpts {
    APIKey?: string
    BaseURL?: string
    DefaultModel?: string
    DefaultModelProvider?: string
    Env?: string[]
}

function globalOptsToEnv(env: NodeJS.ProcessEnv, opts?: GlobalOpts) {
    if (!opts) {
        return
    }

    if (opts.APIKey) {
        env["OPENAI_API_KEY"] = opts.APIKey
    }
    if (opts.BaseURL) {
        env["OPENAI_BASE_URL"] = opts.BaseURL
    }
    if (opts.DefaultModel) {
        env["GPTSCRIPT_SDKSERVER_DEFAULT_MODEL"] = opts.DefaultModel
    }
    if (opts.DefaultModelProvider) {
        env["GPTSCRIPT_SDKSERVER_DEFAULT_MODEL_PROVIDER"] = opts.DefaultModelProvider
    }
}

export interface RunOpts {
    input?: string
    disableCache?: boolean
    quiet?: boolean
    chdir?: string
    subTool?: string
    workspace?: string
    chatState?: string
    confirm?: boolean
    prompt?: boolean
    credentialOverrides?: string[]
    location?: string
    env?: string[]
    forceSequential?: boolean

    APIKey?: string
    BaseURL?: string
    DefaultModel?: string
}

export enum RunEventType {
    Event = "event",
    RunStart = "runStart",
    RunFinish = "runFinish",
    CallStart = "callStart",
    CallChat = "callChat",
    CallSubCalls = "callSubCalls",
    CallProgress = "callProgress",
    CallConfirm = "callConfirm",
    CallContinue = "callContinue",
    CallFinish = "callFinish",

    Prompt = "prompt"
}

export class GPTScript {
    private static serverURL: string = ""
    private static serverProcess: child_process.ChildProcess
    private static instanceCount: number = 0


    private ready: boolean

    constructor(opts?: GlobalOpts) {
        this.ready = false
        GPTScript.instanceCount++
        if (!GPTScript.serverURL) {
            GPTScript.serverURL = "http://" + (process.env.GPTSCRIPT_URL || "127.0.0.1:0")
        }
        if (GPTScript.instanceCount === 1 && process.env.GPTSCRIPT_DISABLE_SERVER !== "true") {
            let env = process.env
            if (opts && opts.Env) {
                env = {}
                for (const v of opts.Env) {
                    const equalIndex = v.indexOf("=")
                    if (equalIndex === -1) {
                        env[v] = ""
                    } else {
                        env[v.substring(0, equalIndex)] = v.substring(equalIndex + 1)
                    }
                }
            }

            globalOptsToEnv(env, opts)
            process.on("exit", (code) => {
                if (GPTScript.serverProcess) {
                    GPTScript.serverProcess.stdin?.end()
                    GPTScript.serverProcess.kill(code)
                }
            })

            GPTScript.serverProcess = child_process.spawn(getCmdPath(), ["sys.sdkserver", "--listen-address", GPTScript.serverURL.replace("http://", "")], {
                env: env,
                stdio: ["pipe", "ignore", "pipe"]
            })

            GPTScript.serverProcess.stderr?.on("data", (data) => {
                let url = data.toString().trim()
                if (url.includes("=")) {
                    url = url.substring(url.indexOf("=") + 1)
                }

                GPTScript.serverURL = `http://${url}`

                GPTScript.serverProcess.stderr?.removeAllListeners()
            })
        }
    }

    close(): void {
        GPTScript.instanceCount--
        if (GPTScript.instanceCount === 0 && GPTScript.serverProcess) {
            GPTScript.serverURL = "http://" + (process.env.GPTSCRIPT_URL || "127.0.0.1:0")
            GPTScript.serverProcess.kill("SIGTERM")
            GPTScript.serverProcess.stdin?.end()
        }
    }

    listTools(): Promise<string> {
        return this.runBasicCommand("list-tools")
    }

    listModels(): Promise<string> {
        return this.runBasicCommand("list-models")
    }

    version(): Promise<string> {
        return this.runBasicCommand("version")
    }

    async runBasicCommand(cmd: string): Promise<string> {
        if (!this.ready) {
            this.ready = await this.testGPTScriptURL(20)
        }
        const r = new RunSubcommand(cmd, "", {}, GPTScript.serverURL)
        r.requestNoStream(null)
        return r.text()
    }

    /**
     * Runs a tool with the specified name and options.
     *
     * @param {string} toolName - The name of the tool to run. Can be a file path, URL, or GitHub URL.
     * @param {RunOpts} [opts={}] - The options for running the tool.
     * @return {Run} The Run object representing the running tool.
     */
    async run(toolName: string, opts: RunOpts = {}): Promise<Run> {
        if (!this.ready) {
            this.ready = await this.testGPTScriptURL(20)
        }
        return (new Run("run", toolName, opts, GPTScript.serverURL)).nextChat(opts.input)
    }

    /**
     * Evaluates the given tool and returns a Run object.
     *
     * @param {ToolDef | ToolDef[]} tool - The tool to be evaluated. Can be a single ToolDef object or an array of ToolDef objects.
     * @param {RunOpts} [opts={}] - Optional options for the evaluation.
     * @return {Run} The Run object representing the evaluation.
     */
    async evaluate(tool: ToolDef | ToolDef[], opts: RunOpts = {}): Promise<Run> {
        if (!this.ready) {
            this.ready = await this.testGPTScriptURL(20)
        }

        return (new Run("evaluate", tool, opts, GPTScript.serverURL)).nextChat(opts.input)
    }

    async parse(fileName: string, disableCache?: boolean): Promise<Block[]> {
        if (!this.ready) {
            this.ready = await this.testGPTScriptURL(20)
        }
        const r: Run = new RunSubcommand("parse", fileName, {disableCache: disableCache}, GPTScript.serverURL)
        r.request({file: fileName})
        return parseBlocksFromNodes((await r.json()).nodes)
    }

    async parseTool(toolContent: string): Promise<Block[]> {
        if (!this.ready) {
            this.ready = await this.testGPTScriptURL(20)
        }
        const r: Run = new RunSubcommand("parse", "", {}, GPTScript.serverURL)
        r.request({content: toolContent})
        return parseBlocksFromNodes((await r.json()).nodes)
    }

    async stringify(blocks: Block[]): Promise<string> {
        if (!this.ready) {
            this.ready = await this.testGPTScriptURL(20)
        }
        const nodes: any[] = []

        for (const block of blocks) {
            if (block.type === "tool") {
                nodes.push({
                    toolNode: {
                        tool: block
                    }
                })
            } else if (block.type === "text") {
                nodes.push({
                    textNode: {
                        text: "!" + (block.format || "text") + "\n" + block.content
                    }
                })
            }
        }

        const r: Run = new RunSubcommand("fmt", "", {}, GPTScript.serverURL)
        r.request({nodes: nodes})
        return r.text()
    }

    async confirm(response: AuthResponse): Promise<void> {
        if (!this.ready) {
            this.ready = await this.testGPTScriptURL(20)
        }
        const resp = await fetch(`${GPTScript.serverURL}/confirm/${response.id}`, {
            method: "POST",
            body: JSON.stringify(response)
        })

        if (resp.status < 200 || resp.status >= 400) {
            throw new Error(`Failed to confirm ${response.id}: ${await resp.text()}`)
        }
    }

    async promptResponse(response: PromptResponse): Promise<void> {
        if (!this.ready) {
            this.ready = await this.testGPTScriptURL(20)
        }
        const resp = await fetch(`${GPTScript.serverURL}/prompt-response/${response.id}`, {
            method: "POST",
            body: JSON.stringify(response.responses)
        })

        if (resp.status < 200 || resp.status >= 400) {
            throw new Error(`Failed to respond to prompt ${response.id}: ${await resp.text()}`)
        }
    }

    private async testGPTScriptURL(count: number): Promise<boolean> {
        while (count > 0) {
            try {
                await fetch(`${GPTScript.serverURL}/healthz`)
                return true
            } catch {
                if (count === 0) {
                }
                await new Promise(r => setTimeout(r, 500))
                count--
            }
        }

        throw new Error("Failed to wait for gptscript to be ready")
    }
}

export class Run {
    public readonly id: string
    public readonly opts: RunOpts
    public readonly tools?: ToolDef | ToolDef[] | string
    public state: RunState = RunState.Creating
    public calls: Record<string, CallFrame> = {}
    public err: string = ""

    protected stdout?: string

    private readonly gptscriptURL?: string
    private readonly requestPath: string = ""
    private promise?: Promise<string>
    private req?: http.ClientRequest
    private stderr?: string
    private callbacks: Record<string, ((f: Frame) => void)[]> = {}
    private chatState?: string
    private parentCallId: string = ""
    private prg?: Program
    private respondingToolId?: string

    constructor(subCommand: string, tools: ToolDef | ToolDef[] | string, opts: RunOpts, gptscriptURL?: string) {
        this.id = randomId("run-")
        this.requestPath = subCommand
        this.opts = opts
        this.tools = tools

        this.gptscriptURL = gptscriptURL
    }

    nextChat(input: string = ""): Run {
        if (this.state !== RunState.Continue && this.state !== RunState.Creating && this.state !== RunState.Error) {
            throw (new Error(`Run must in creating, continue or error state, not ${this.state}`))
        }

        let run = this
        if (run.state !== RunState.Creating) {
            run = new (this.constructor as any)(this.requestPath, this.tools, this.opts, this.gptscriptURL)
        }

        if (this.chatState && this.state === RunState.Continue) {
            // Only update the chat state if the previous run didn't error.
            // The chat state on opts will be the chat state for the last successful run.
            this.opts.chatState = this.chatState
        }
        run.opts.input = input
        if (Array.isArray(this.tools)) {
            run.request({toolDefs: this.tools, ...this.opts})
        } else if (typeof this.tools === "string") {
            run.request({file: this.tools, ...this.opts})
        } else {
            // In this last case, this.tools is a single ToolDef.
            run.request({toolDefs: [this.tools], ...this.opts})
        }

        return run
    }

    processStdout(data: string | object): string {
        if (typeof data === "string") {
            if (data.trim() === "") {
                return ""
            }

            try {
                data = JSON.parse(data)
            } catch (e) {
                return data as string
            }
        }

        const out = data as ChatState
        if (out.done === undefined || !out.done) {
            this.chatState = JSON.stringify(out.state)
            this.state = RunState.Continue
            this.respondingToolId = out.toolId
        } else {
            this.state = RunState.Finished
            this.chatState = undefined
        }

        return ""
    }

    request(tool: any) {
        if (!this.gptscriptURL) {
            throw new Error("request() requires gptscriptURL to be set")
        }
        const options = this.requestOptions(this.gptscriptURL, this.requestPath, tool)
        options.headers = {"Transfer-Encoding": "chunked", ...options.headers} as any

        this.promise = new Promise<string>(async (resolve, reject) => {
            let frag = ""
            this.req = http.request(options, (res: http.IncomingMessage) => {
                this.state = RunState.Running
                res.on("data", (chunk: any) => {
                    for (let line of (frag + chunk.toString()).split("\n")) {
                        const c = line.replace(/^(data: )/, "").trim()
                        if (!c) {
                            continue
                        }

                        if (c === "[DONE]") {
                            return
                        }

                        let e: any
                        try {
                            e = JSON.parse(c)
                        } catch {
                            frag = c
                            return
                        }

                        if (e.stderr) {
                            this.stderr = (this.stderr || "") + (typeof e.stderr === "string" ? e.stderr : JSON.stringify(e.stderr))
                            frag = ""
                        } else if (e.stdout) {
                            frag = this.processStdout(e.stdout)
                        } else {
                            frag = this.emitEvent(c)
                        }
                    }
                })

                res.on("end", () => {
                    if (this.state === RunState.Running || this.state === RunState.Finished || this.state === RunState.Continue) {
                        if (this.stdout) {
                            if (this.state !== RunState.Continue) {
                                this.state = RunState.Finished
                            }
                            resolve(this.stdout)
                        } else {
                            this.state = RunState.Error
                            reject(this.stderr)
                        }
                    } else if (this.state === RunState.Error) {
                        reject(this.err)
                    }
                })

                res.on("aborted", () => {
                    if (this.state !== RunState.Finished && this.state !== RunState.Error) {
                        this.state = RunState.Error
                        this.err = "Run has been aborted"
                        reject(this.err)
                    }
                })

                res.on("error", (error: Error) => {
                    if (this.state !== RunState.Error) {
                        this.state = RunState.Error
                        this.err = error.message || ""
                    }
                    reject(this.err)
                })
            })

            this.req.on("error", (error: Error) => {
                if (this.state !== RunState.Error) {
                    this.state = RunState.Error
                    this.err = error.message || ""
                }
                reject(this.err)
            })

            this.req.write(JSON.stringify({...tool, ...this.opts}))
            this.req.end()
        })
    }

    requestNoStream(tool: any) {
        if (!this.gptscriptURL) {
            throw new Error("request() requires gptscriptURL to be set")
        }

        const options = this.requestOptions(this.gptscriptURL, this.requestPath, tool) as any
        if (tool) {
            options.body = {...tool, ...this.opts}
        }
        const req = new Request(this.gptscriptURL + "/" + this.requestPath, options)

        this.promise = new Promise<string>(async (resolve, reject) => {
            fetch(req).then(resp => resp.json()).then(res => resolve(res.stdout)).catch(e => {
                reject(e)
            })
        })
    }

    requestOptions(gptscriptURL: string, path: string, tool: any) {
        let method = "GET"
        if (tool) {
            method = "POST"
        }

        const url = new URL(gptscriptURL)

        return {
            hostname: url.hostname,
            port: url.port || 80,
            protocol: url.protocol || "http:",
            path: "/" + path,
            method: method,
            headers: {
                "Content-Type": "application/json"
            },
        }
    }

    public on(event: RunEventType.RunStart | RunEventType.RunFinish, listener: (data: RunFrame) => void): this;
    public on(event: RunEventType.CallStart | RunEventType.CallProgress | RunEventType.CallContinue | RunEventType.CallChat | RunEventType.CallConfirm | RunEventType.CallFinish, listener: (data: CallFrame) => void): this;
    public on(event: RunEventType.Prompt, listener: (data: PromptFrame) => void): this;
    public on(event: RunEventType.Event, listener: (data: Frame) => void): this;
    public on(event: RunEventType, listener: (data: any) => void): this {
        if (!this.callbacks[event]) {
            this.callbacks[event] = []
        }

        this.callbacks[event].push(listener)

        return this
    }

    public text(): Promise<string> {
        if (this.err) {
            throw new Error(this.err)
        }

        if (!this.promise) {
            throw new Error("Run not started")
        }

        return this.promise
    }

    public async json(): Promise<any> {
        return JSON.parse(await this.text())
    }

    public currentChatState(): string | undefined {
        return this.chatState
    }

    public parentCallFrame(): CallFrame | undefined {
        if (this.parentCallId) {
            return this.calls[this.parentCallId]
        }

        return undefined
    }

    public program(): Program | undefined {
        return this.prg
    }

    public respondingTool(): Tool | undefined {
        return this.respondingToolId ? this.prg?.toolSet[this.respondingToolId] : undefined
    }

    public close(): void {
        if (this.req) {
            this.req.destroy()
            return
        }
        throw new Error("Run not started")
    }

    private emitEvent(data: string): string {
        for (let event of data.split("\n")) {
            event = event.trim()

            if (!event) {
                continue
            }
            let f: Frame
            try {
                const obj = JSON.parse(event)
                if (obj.run) {
                    f = obj.run as Frame
                } else if (obj.call) {
                    f = obj.call as Frame
                } else if (obj.prompt) {
                    f = obj.prompt as Frame
                } else {
                    return event
                }
            } catch (error) {
                return event
            }

            if (!this.state) {
                this.state = RunState.Creating
            }

            if (f.type === RunEventType.Prompt && !this.opts.prompt) {
                this.state = RunState.Error
                this.err = `prompt occurred when prompt was not allowed: Message: ${f.message}\nFields: ${f.fields}\nSensitive: ${f.sensitive}`
                this.close()
                return ""
            }

            if (f.type === RunEventType.RunStart) {
                this.state = RunState.Running
                this.prg = f.program
            } else if (f.type === RunEventType.RunFinish) {
                if (f.error) {
                    this.state = RunState.Error
                    this.err = f.error || ""
                } else {
                    this.state = RunState.Finished
                    this.stdout = f.output || ""
                }
            } else if ((f.type as string).startsWith("call")) {
                f = f as CallFrame
                if (!f.parentID && this.parentCallId === "") {
                    this.parentCallId = f.id
                }
                this.calls[f.id] = f
            }

            this.emit(RunEventType.Event, f)
            this.emit(f.type, f)
        }

        return ""
    }

    private emit(event: RunEventType, data: any) {
        for (const cb of this.callbacks[event] || []) {
            cb(data)
        }
    }
}

class RunSubcommand extends Run {
    constructor(subCommand: string, tool: ToolDef | ToolDef[] | string, opts: RunOpts, gptscriptURL?: string) {
        super(subCommand, tool, opts, gptscriptURL)
    }

    processStdout(data: string | object): string {
        if (typeof data === "string") {
            this.stdout = (this.stdout || "") + data
        } else {
            this.stdout = JSON.stringify(data)
        }

        return ""
    }
}

interface ChatState {
    state: string
    done: boolean
    content: string
    toolId: string
}

export type Arguments = string | Record<string, string>

export const ArgumentSchemaType = "object" as const

export interface ArgumentSchema {
    type: typeof ArgumentSchemaType
    properties?: Record<string, Property>
    required?: string[]
}

export interface Program {
    name: string
    toolSet: Record<string, Tool>
    openAPICache: Record<string, any>
}

export const PropertyType = "string" as const

export interface Property {
    type: typeof PropertyType
    description: string
    default?: string
}

export interface Repo {
    VCS: string
    Root: string
    Path: string
    Name: string
    Revision: string
}

export interface ToolDef {
    name?: string
    description?: string
    maxTokens?: number
    modelName?: string
    modelProvider?: boolean
    jsonResponse?: boolean
    temperature?: number
    cache?: boolean
    chat?: boolean
    internalPrompt?: boolean
    arguments?: ArgumentSchema
    tools?: string[]
    globalTools?: string[]
    globalModelName?: string
    context?: string[]
    exportContext?: string[]
    export?: string[]
    agents?: string[]
    credentials?: string[]
    instructions?: string
    type?: string
    metaData?: Record<string, string>
}

export interface ToolReference {
    named: string
    reference: string
    arg: string
    toolID: string
}

export const ToolType = "tool" as const

export interface Tool extends ToolDef {
    id: string
    type: typeof ToolType
    toolMapping?: Record<string, ToolReference[]>
    localTools?: Record<string, string>
    source?: SourceRef
    workingDir?: string
}

export interface SourceRef {
    location: string
    lineNo: number
    repo?: Repo
}

export const TextType = "text" as const

export interface Text {
    id: string
    type: typeof TextType
    format: string
    content: string
}

export type Block = Tool | Text

export enum RunState {
    Creating = "creating",
    Running = "running",
    Continue = "continue",
    Finished = "finished",
    Error = "error"
}

export enum ToolCategory {
    ProviderToolCategory = "provider",
    CredentialToolCategory = "credential",
    ContextToolCategory = "context",
    InputToolCategory = "input",
    OutputToolCategory = "output",
    NoCategory = ""
}

export interface RunFrame {
    id: string
    type: RunEventType.RunStart | RunEventType.RunFinish
    program: Program
    input: string
    output: string
    error: string
    start: string
    end: string
    state: RunState
    chatState: any
}

export interface Call {
    toolID: string
    input?: string
}

export interface Output {
    content?: string
    subCalls: Record<string, Call>
}

export interface InputContext {
    toolID: string
    content: string
}

export interface Usage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}

export interface CallFrame {
    id: string
    tool?: Tool
    agentGroup?: ToolReference[]
    currentAgent?: ToolReference
    displayText?: string
    inputContext: InputContext[]
    toolCategory?: ToolCategory
    toolName: string
    parentID?: string
    type: RunEventType.CallStart | RunEventType.CallChat | RunEventType.CallConfirm | RunEventType.CallContinue | RunEventType.CallSubCalls | RunEventType.CallProgress | RunEventType.CallFinish
    start: string
    end: string
    input: Arguments
    output: Output[]
    error?: string
    usage: Usage
    llmRequest?: any
    llmResponse?: any
}

export interface PromptFrame {
    id: string
    type: RunEventType.Prompt
    time: string
    message: string
    fields: string[]
    sensitive: boolean
}

export type Frame = RunFrame | CallFrame | PromptFrame

export interface AuthResponse {
    id: string
    accept: boolean
    message?: string
}

export interface PromptResponse {
    id: string
    responses: Record<string, string>
}

export function getEnv(key: string, def: string = ""): string {
    let v = process.env[key] || ""
    if (v == "") {
        return def
    }

    if (v.startsWith("{\"_gz\":\"") && v.endsWith("\"}")) {
        try {
            return gunzipSync(Buffer.from(v.slice(8, -2), "base64")).toString("utf8")
        } catch (e) {
        }
    }

    return v
}

function getCmdPath(): string {
    if (process.env.GPTSCRIPT_BIN) {
        return process.env.GPTSCRIPT_BIN
    }

    return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "gptscript" + (process.platform === "win32" ? ".exe" : ""))
}

function parseBlocksFromNodes(nodes: any[]): Block[] {
    const blocks: Block[] = []
    for (const node of nodes) {
        if (node.toolNode) {
            if (!node.toolNode.tool.id) {
                node.toolNode.tool.id = randomId("tool-")
            }
            blocks.push({
                type: "tool",
                ...node.toolNode.tool,
            } as Tool)
        }
        if (node.textNode) {
            const format = node.textNode.text.substring(1, node.textNode.text.indexOf("\n")).trim() || "text"
            blocks.push({
                id: randomId("text-"),
                type: "text",
                format: format,
                content: node.textNode.text.substring(node.textNode.text.indexOf("\n") + 1).trim(),
            } as Text)
        }
    }
    return blocks
}

function randomId(prefix: string): string {
    return prefix + Math.random().toString(36).substring(2, 12)
}
