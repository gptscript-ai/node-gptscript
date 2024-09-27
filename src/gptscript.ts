import http from "http"
import path from "path"
import child_process from "child_process"
import {fileURLToPath} from "url"
import {gunzipSync} from "zlib"

export interface GlobalOpts {
    URL?: string
    Token?: string
    CacheDir?: string
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
    credentialContexts?: string[]
    location?: string
    env?: string[]
    forceSequential?: boolean

    URL?: string
    Token?: string
    CacheDir?: string
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


    private readonly opts: GlobalOpts

    constructor(opts?: GlobalOpts) {
        this.opts = opts || {}
        GPTScript.instanceCount++

        let startSDK = !GPTScript.serverProcess && !GPTScript.serverURL && !this.opts.URL

        if (!GPTScript.serverURL) {
            GPTScript.serverURL = process.env.GPTSCRIPT_URL ?? ""
            startSDK = startSDK && !GPTScript.serverURL
        }

        if (!this.opts.Token) {
            this.opts.Token = process.env.GPTSCRIPT_TOKEN
        }

        if (startSDK) {
            let env = process.env
            if (this.opts.Env) {
                env = {
                    "NODE_ENV": process.env.NODE_ENV
                }
                for (const v of this.opts.Env) {
                    const equalIndex = v.indexOf("=")
                    if (equalIndex === -1) {
                        env[v] = ""
                    } else {
                        env[v.substring(0, equalIndex)] = v.substring(equalIndex + 1)
                    }
                }
            }

            globalOptsToEnv(env, this.opts)
            process.on("exit", (code) => {
                if (GPTScript.serverProcess) {
                    GPTScript.serverProcess.stdin?.end()
                    GPTScript.serverProcess.kill(code)
                }
            })

            GPTScript.serverProcess = child_process.spawn(getCmdPath(), ["sys.sdkserver", "--listen-address", "127.0.0.1:0"], {
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
        } else {
            if (!this.opts.URL) {
                this.opts.URL = GPTScript.serverURL
            }

            if (!this.opts.Env) {
                this.opts.Env = []
            }
            if (this.opts.URL) {
                this.opts.Env.push(`GPTSCRIPT_URL=${this.opts.URL}`)
            }

            if (this.opts.Token) {
                this.opts.Env.push(`GPTSCRIPT_TOKEN=${this.opts.Token}`)
            }
        }
    }

    close(): void {
        GPTScript.instanceCount--
        if (GPTScript.instanceCount === 0 && GPTScript.serverProcess) {
            GPTScript.serverURL = process.env.GPTSCRIPT_URL ?? ""
            GPTScript.serverProcess.kill("SIGTERM")
            GPTScript.serverProcess.stdin?.end()
        }
    }

    listModels(providers?: string[], credentialOverrides?: string[]): Promise<string> {
        if (this.opts.DefaultModelProvider) {
            if (!providers) {
                providers = []
            }
            providers.push(this.opts.DefaultModelProvider)
        }
        return this.runBasicCommand("list-models", {
            "providers": providers,
            "env": this.opts.Env,
            "credentialOverrides": credentialOverrides
        })
    }

    version(): Promise<string> {
        return this.runBasicCommand("version")
    }

    async runBasicCommand(cmd: string, body?: any): Promise<string> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        const r = new RunSubcommand(cmd, "", {URL: this.opts.URL, Token: this.opts.Token})
        r.requestNoStream(body)
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
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        if (this.opts.Env) {
            opts.env = this.opts.Env.concat(opts.env || [])
        }

        return (new Run("run", toolName, {...this.opts, ...opts})).nextChat(opts.input)
    }

    /**
     * Evaluates the given tool and returns a Run object.
     *
     * @param {ToolDef | ToolDef[]} tool - The tool to be evaluated. Can be a single ToolDef object or an array of ToolDef objects.
     * @param {RunOpts} [opts={}] - Optional options for the evaluation.
     * @return {Run} The Run object representing the evaluation.
     */
    async evaluate(tool: Tool | ToolDef | ToolDef[], opts: RunOpts = {}): Promise<Run> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        if (this.opts.Env) {
            opts.env = this.opts.Env.concat(opts.env || [])
        }
        return (new Run("evaluate", tool, {...this.opts, ...opts})).nextChat(opts.input)
    }

    async parse(fileName: string, disableCache?: boolean): Promise<Block[]> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        const r: Run = new RunSubcommand("parse", fileName, {
            disableCache: disableCache,
            URL: this.opts.URL,
            Token: this.opts.Token
        })
        r.request({file: fileName})
        return parseBlocksFromNodes((await r.json()).nodes)
    }

    async parseContent(toolContent: string): Promise<Block[]> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        const r: Run = new RunSubcommand("parse", "", {URL: this.opts.URL, Token: this.opts.Token})
        r.request({content: toolContent})
        return parseBlocksFromNodes((await r.json()).nodes)
    }

    async stringify(blocks: Block[]): Promise<string> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        const nodes: any[] = []

        for (const block of blocks) {
            if (block.type === "text") {
                nodes.push({
                    textNode: {
                        text: "!" + (block.format || "text") + "\n" + block.content
                    }
                })
            } else {
                nodes.push({
                    toolNode: {
                        tool: block
                    }
                })
            }
        }

        const r: Run = new RunSubcommand("fmt", "", {URL: this.opts.URL, Token: this.opts.Token})
        r.request({nodes: nodes})
        return r.text()
    }

    async confirm(response: AuthResponse): Promise<void> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        const resp = await fetch(`${this.opts.URL}/confirm/${response.id}`, {
            method: "POST",
            body: JSON.stringify(response)
        })

        if (resp.status < 200 || resp.status >= 400) {
            throw new Error(`Failed to confirm ${response.id}: ${await resp.text()}`)
        }
    }

    async promptResponse(response: PromptResponse): Promise<void> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        const resp = await fetch(`${this.opts.URL}/prompt-response/${response.id}`, {
            method: "POST",
            body: JSON.stringify(response.responses)
        })

        if (resp.status < 200 || resp.status >= 400) {
            throw new Error(`Failed to respond to prompt ${response.id}: ${await resp.text()}`)
        }
    }

    /**
     * Loads a file into a Program.
     *
     * @param {string} fileName - The name of the file to load.
     * @param {boolean} [disableCache] - Whether to disable the cache.
     * @param {string} [subTool] - The sub-tool to use.
     * @return {Promise<LoadResponse>} The loaded program.
     */
    async load(
        fileName: string,
        disableCache?: boolean,
        subTool?: string
    ): Promise<LoadResponse> {
        return this._load({file: fileName, disableCache, subTool})
    }

    /**
     * Loads content into a Program.
     *
     * @param {string} content - The content to load.
     * @param {boolean} [disableCache] - Whether to disable the cache.
     * @param {string} [subTool] - The sub-tool to use.
     * @return {Promise<LoadResponse>} The loaded program.
     */
    async loadContent(
        content: string,
        disableCache?: boolean,
        subTool?: string
    ): Promise<LoadResponse> {
        return this._load({content, disableCache, subTool})
    }

    /**
     * Loads tools into a Program.
     *
     * @param {ToolDef[]} toolDefs - The tools to load.
     * @param {boolean} [disableCache] - Whether to disable the cache.
     * @param {string} [subTool] - The sub-tool to use.
     * @return {Promise<LoadResponse>} The loaded program.
     */
    async loadTools(
        toolDefs: ToolDef[],
        disableCache?: boolean,
        subTool?: string
    ): Promise<LoadResponse> {
        return this._load({toolDefs, disableCache, subTool})
    }

    async listCredentials(context: Array<string>, allContexts: boolean): Promise<Array<Credential>> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }

        const r: Run = new RunSubcommand("credentials", "", {URL: this.opts.URL, Token: this.opts.Token})
        r.request({context, allContexts})
        const out = await r.json()
        return out.map((c: any) => jsonToCredential(JSON.stringify(c)))
    }

    async createCredential(credential: Credential): Promise<void> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }

        const r: Run = new RunSubcommand("credentials/create", "", {URL: this.opts.URL, Token: this.opts.Token})
        r.request({content: credentialToJSON(credential)})
        await r.text()
    }

    async revealCredential(context: Array<string>, name: string): Promise<Credential> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }

        const r: Run = new RunSubcommand("credentials/reveal", "", {URL: this.opts.URL, Token: this.opts.Token})
        r.request({context, name})
        return jsonToCredential(await r.text())
    }

    async deleteCredential(context: string, name: string): Promise<void> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }

        const r: Run = new RunSubcommand("credentials/delete", "", {URL: this.opts.URL, Token: this.opts.Token})
        r.request({context: [context], name})
        await r.text()
    }

    /**
     * Helper method to handle the common logic for loading.
     *
     * @param {any} payload - The payload to send in the request.
     * @return {Promise<LoadResponse>} The loaded program.
     */
    private async _load(payload: any): Promise<LoadResponse> {
        if (!this.opts.URL) {
            await this.testGPTScriptURL(20)
        }
        const r: Run = new RunSubcommand("load", payload.toolDefs || [], {URL: this.opts.URL, Token: this.opts.Token})

        r.request(payload)
        return (await r.json()) as LoadResponse
    }

    private async testGPTScriptURL(count: number): Promise<void> {
        while (count > 0) {
            try {
                await fetch(`${GPTScript.serverURL}/healthz`)
                this.opts.URL = GPTScript.serverURL
                if (!this.opts.Env) {
                    this.opts.Env = []
                }
                this.opts.Env.push(`GPTSCRIPT_URL=${this.opts.URL}`)
                if (this.opts.Token) {
                    this.opts.Env.push(`GPTSCRIPT_TOKEN=${this.opts.Token}`)
                }

                return
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

    private readonly requestPath: string = ""
    private promise?: Promise<string>
    private req?: http.ClientRequest
    private stderr?: string
    private callbacks: Record<string, ((f: Frame) => void)[]> = {}
    private chatState?: string
    private parentCallId: string = ""
    private prg?: Program
    private respondingToolId?: string

    constructor(subCommand: string, tools: ToolDef | ToolDef[] | string, opts: RunOpts) {
        this.id = randomId("run-")
        this.requestPath = subCommand
        this.opts = opts
        this.tools = tools
    }

    nextChat(input: string = ""): Run {
        if (this.state !== RunState.Continue && this.state !== RunState.Creating && this.state !== RunState.Error) {
            throw (new Error(`Run must in creating, continue or error state, not ${this.state}`))
        }

        let run = this
        if (run.state !== RunState.Creating) {
            run = new (this.constructor as any)(this.requestPath, this.tools, this.opts)
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
            this.respondingToolId = out.toolID
        } else {
            this.state = RunState.Finished
            this.chatState = undefined
        }

        return ""
    }

    request(tool: any) {
        if (!this.opts.URL) {
            throw new Error("request() requires URL to be set")
        }
        const options = this.requestOptions(this.opts.URL, this.opts.Token || "", this.requestPath, tool)
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
                        if (this.stdout || !this.stderr) {
                            if (this.state !== RunState.Continue) {
                                this.state = RunState.Finished
                            }
                            resolve(this.stdout || "")
                        } else {
                            this.state = RunState.Error
                            reject(new Error(this.stderr))
                        }
                    } else if (this.state === RunState.Error) {
                        reject(new Error(this.err))
                    }
                })

                res.on("aborted", () => {
                    if (this.state !== RunState.Finished && this.state !== RunState.Error) {
                        this.state = RunState.Error
                        this.err = "Run has been aborted"
                        reject(new Error(this.err))
                    }
                })

                res.on("error", (error: Error) => {
                    if (this.state !== RunState.Error) {
                        this.state = RunState.Error
                        this.err = error.message || ""
                    }
                    reject(new Error(this.err))
                })
            })

            this.req.on("error", (error: Error) => {
                if (this.state !== RunState.Error) {
                    this.state = RunState.Error
                    this.err = error.message || ""
                }
                reject(new Error(this.err))
            })

            this.req.write(JSON.stringify({...tool, ...this.opts}))
            this.req.end()
        })
    }

    requestNoStream(tool: any) {
        if (!this.opts.URL) {
            throw new Error("request() requires gptscriptURL to be set")
        }

        const options = this.requestOptions(this.opts.URL, this.opts.Token || "", this.requestPath, tool) as any
        if (tool) {
            options.body = JSON.stringify({...tool, ...this.opts})
        }
        const req = new Request(this.opts.URL + "/" + this.requestPath, options)

        this.promise = new Promise<string>(async (resolve, reject) => {
            fetch(req).then(resp => {
                return resp.json()
            }).then(res => {
                resolve(res.stdout)
            }).catch(e => {
                reject(new Error(e))
            })
        })
    }

    requestOptions(gptscriptURL: string, token: string, path: string, tool: any) {
        let method = "GET"
        if (tool) {
            method = "POST"
        }

        const url = new URL(gptscriptURL)

        const headers = {
            "Content-Type": "application/json"
        } as any
        if (token) {
            headers["Authorization"] = `Bearer ${token}`
        }

        return {
            hostname: url.hostname,
            port: url.port || 80,
            protocol: url.protocol || "http:",
            path: "/" + path,
            method: method,
            headers: headers
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
    constructor(subCommand: string, tool: ToolDef | ToolDef[] | string, opts: RunOpts) {
        super(subCommand, tool, opts)
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
    toolID: string
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
    entryToolId: string
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

export type ToolType = "tool" | "context" | "credential" | "input" | "output" | "agent" | "assistant" | "provider" | ""

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
    exportCredentials?: string[]
    inputFilters?: string[]
    exportInputFilters?: string[]
    outputFilters?: string[]
    exportOutputFilters?: string[]
    instructions?: string
    type?: ToolType
    metaData?: Record<string, string>
}

export interface ToolReference {
    named: string
    reference: string
    arg: string
    toolID: string
}


export interface Tool extends ToolDef {
    id: string
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
    chatResponseCached: boolean
    toolResults: number
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
    metadata: Record<string, string>
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

export interface LoadResponse {
    program: Program;
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
    if (!nodes) {
        return blocks
    }

    for (const node of nodes) {
        if (node.toolNode) {
            if (!node.toolNode.tool.id) {
                node.toolNode.tool.id = randomId("tool-")
            }
            blocks.push({
                type: node.toolNode.tool.type || "tool",
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

export enum CredentialType {
    Tool = "tool",
    ModelProvider = "modelProvider",
}

export type Credential = {
    context: string
    name: string
    type: CredentialType
    env: Record<string, string>
    ephemeral: boolean
    expiresAt?: Date | undefined
    refreshToken?: string | undefined
}

// for internal use only
type cred = {
    context: string
    toolName: string
    type: string
    env: Record<string, string>
    ephemeral: boolean
    expiresAt: string | undefined
    refreshToken: string | undefined
}

export function credentialToJSON(c: Credential): string {
    const expiresAt = c.expiresAt ? c.expiresAt.toISOString() : undefined
    const type = c.type === CredentialType.Tool ? "tool" : "modelProvider"
    return JSON.stringify({
        context: c.context,
        toolName: c.name,
        type: type,
        env: c.env,
        ephemeral: c.ephemeral,
        expiresAt: expiresAt,
        refreshToken: c.refreshToken
    } as cred)
}

function jsonToCredential(cred: string): Credential {
    const c = JSON.parse(cred) as cred
    return {
        context: c.context,
        name: c.toolName,
        type: c.type === "tool" ? CredentialType.Tool : CredentialType.ModelProvider,
        env: c.env,
        ephemeral: c.ephemeral,
        expiresAt: c.expiresAt ? new Date(c.expiresAt) : undefined,
        refreshToken: c.refreshToken
    }
}
