import http from "http"
import path from "path"
import child_process from "child_process"
import {fileURLToPath} from "url"

export interface RunOpts {
	input?: string
	disableCache?: boolean
	quiet?: boolean
	chdir?: string
	subTool?: string
	workspace?: string
	chatState?: string
	confirm?: boolean
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
}

let serverProcess: child_process.ChildProcess
let clientCount: number = 0

export class Client {
	private readonly gptscriptURL: string
	private clientReady: boolean

	constructor() {
		this.clientReady = false
		this.gptscriptURL = "http://" + (process.env.GPTSCRIPT_URL || "127.0.0.1:9090")
		clientCount++
		if (clientCount === 1 && process.env.GPTSCRIPT_DISABLE_SERVER !== "true") {
			serverProcess = child_process.spawn(getCmdPath(), ["--listen-address", this.gptscriptURL.replace("http://", "").replace("https://", ""), "sdkserver"], {
				env: process.env,
				stdio: ["pipe"]
			})

			process.on("exit", (code) => {
				serverProcess.stdin?.end()
				serverProcess.kill(code)
			})
		}
	}

	close(): void {
		clientCount--
		if (clientCount === 0 && serverProcess) {
			serverProcess.kill("SIGTERM")
			serverProcess.stdin?.end()
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
		if (!this.clientReady) {
			this.clientReady = await this.testGPTScriptURL(20)
		}
		const r = new RunSubcommand(cmd, "", "", {}, this.gptscriptURL)
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
		if (!this.clientReady) {
			this.clientReady = await this.testGPTScriptURL(20)
		}
		return (new Run("run", toolName, "", opts, this.gptscriptURL)).nextChat(opts.input)
	}

	/**
	 * Evaluates the given tool and returns a Run object.
	 *
	 * @param {ToolDef | ToolDef[] | string} tool - The tool to be evaluated. Can be a single ToolDef object, an array of ToolDef objects, or a string representing the tool contents.
	 * @param {RunOpts} [opts={}] - Optional options for the evaluation.
	 * @return {Run} The Run object representing the evaluation.
	 */
	async evaluate(tool: ToolDef | ToolDef[] | string, opts: RunOpts = {}): Promise<Run> {
		if (!this.clientReady) {
			this.clientReady = await this.testGPTScriptURL(20)
		}
		let toolString: string = ""

		if (Array.isArray(tool)) {
			toolString = toolArrayToContents(tool)
		} else if (typeof tool === "string") {
			toolString = tool
		} else {
			toolString = toolDefToString(tool)
		}

		return (new Run("evaluate", "", toolString, opts, this.gptscriptURL)).nextChat(opts.input)
	}

	async parse(fileName: string): Promise<Block[]> {
		if (!this.clientReady) {
			this.clientReady = await this.testGPTScriptURL(20)
		}
		const r: Run = new RunSubcommand("parse", fileName, "", {}, this.gptscriptURL)
		r.request({file: fileName})
		return parseBlocksFromNodes((await r.json()).nodes)
	}

	async parseTool(toolContent: string): Promise<Block[]> {
		if (!this.clientReady) {
			this.clientReady = await this.testGPTScriptURL(20)
		}
		const r: Run = new RunSubcommand("parse", "", toolContent, {}, this.gptscriptURL)
		r.request({content: toolContent})
		return parseBlocksFromNodes((await r.json()).nodes)
	}

	async stringify(blocks: Block[]): Promise<string> {
		if (!this.clientReady) {
			this.clientReady = await this.testGPTScriptURL(20)
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

		const r: Run = new RunSubcommand("fmt", "", JSON.stringify({nodes: nodes}), {}, this.gptscriptURL)
		r.request({nodes: nodes})
		return r.text()
	}

	async confirm(response: AuthResponse): Promise<void> {
		if (!this.clientReady) {
			this.clientReady = await this.testGPTScriptURL(20)
		}
		const resp = await fetch(`${this.gptscriptURL}/confirm/${response.id}`, {
			method: "POST",
			body: JSON.stringify(response)
		})

		if (resp.status < 200 || resp.status >= 400) {
			throw new Error(`Failed to confirm ${response.id}: ${await resp.text()}`)
		}
	}

	private async testGPTScriptURL(count: number): Promise<boolean> {
		try {
			await fetch(`${this.gptscriptURL}/healthz`)
			return true
		} catch {
			if (count === 0) {
				throw new Error("Failed to wait for gptscript to be ready")
			}
			await new Promise(r => setTimeout(r, 500))
			return this.testGPTScriptURL(count - 1)
		}
	}
}

export class Run {
	public readonly id: string
	public readonly opts: RunOpts
	public readonly filePath: string
	public readonly content: string
	public state: RunState = RunState.Creating
	public calls: CallFrame[] = []
	public err: string = ""

	protected stdout?: string

	private readonly gptscriptURL?: string
	private readonly requestPath: string = ""
	private promise?: Promise<string>
	private req?: http.ClientRequest
	private stderr?: string
	private callbacks: Record<string, ((f: Frame) => void)[]> = {}
	private chatState?: string

	constructor(subCommand: string, path: string, content: string, opts: RunOpts, gptscriptURL?: string) {
		this.id = randomId("run-")
		this.requestPath = subCommand
		this.opts = opts
		this.filePath = path
		this.content = content

		this.gptscriptURL = gptscriptURL
	}

	nextChat(input: string = ""): Run {
		if (this.state === RunState.Finished || this.state === RunState.Error) {
			throw (new Error("Run already finished"))
		}

		let run = this
		if (run.state !== RunState.Creating) {
			run = new (this.constructor as any)(this.requestPath, this.filePath, this.content, this.opts, this.gptscriptURL)
		}

		if (this.chatState) {
			run.chatState = this.chatState
		} else if (this.opts.chatState) {
			run.chatState = this.opts.chatState
		}
		run.opts.input = input
		if (run.content !== "") {
			run.request({content: this.content, chatState: run.chatState})
		} else {
			run.request({file: this.filePath, chatState: run.chatState})
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
					if (this.state !== RunState.Finished) {
						this.state = RunState.Error
						this.err = "Run has been aborted"
						reject(this.err)
					}
				})

				res.on("error", (error: Error) => {
					this.state = RunState.Error
					this.err = error.message || ""
					reject(this.err)
				})
			})

			this.req.on("error", (error: Error) => {
				this.state = RunState.Error
				this.err = error.message || ""
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

	emitEvent(data: string): string {
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
				} else {
					return event
				}
			} catch (error) {
				return event
			}

			if (!this.state) {
				this.state = RunState.Creating
			}

			if (f.type === RunEventType.RunStart) {
				this.state = RunState.Running
			} else if (f.type === RunEventType.RunFinish) {
				if (f.error) {
					this.state = RunState.Error
					this.err = f.error || ""
				} else {
					this.state = RunState.Finished
					this.stdout = f.output || ""
				}
			} else {
				if (!(f.type as string).startsWith("call")) continue
				f = (f as CallFrame)
				const idx = this.calls?.findIndex((x) => x.id === f.id)

				if (idx === -1) {
					this.calls.push(f)
				} else {
					this.calls[idx] = f
				}
			}

			this.emit(RunEventType.Event, f)
			this.emit(f.type, f)
		}

		return ""
	}

	public on(event: RunEventType.RunStart | RunEventType.RunFinish, listener: (data: RunFrame) => void): this;
	public on(event: RunEventType.CallStart | RunEventType.CallProgress | RunEventType.CallContinue | RunEventType.CallChat | RunEventType.CallConfirm | RunEventType.CallFinish, listener: (data: CallFrame) => void): this;
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

	public close(): void {
		if (this.req) {
			this.req.destroy()
			return
		}
		throw new Error("Run not started")
	}

	private emit(event: RunEventType, data: any) {
		for (const cb of this.callbacks[event] || []) {
			cb(data)
		}
	}
}

class RunSubcommand extends Run {
	constructor(subCommand: string, path: string, content: string, opts: RunOpts, gptscriptURL?: string) {
		super(subCommand, path, content, opts, gptscriptURL)
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

export interface ArgumentSchema {
	type: "object"
	properties?: Record<string, Property>
	required?: string[]
}

export interface Program {
	name: string
	blocks: Block[]
	openAPICache: Record<string, any>
}

export interface Property {
	type: "string"
	description: string
	default?: string
}

export interface Repo {
	vcs: string
	root: string
	path: string
	name: string
	revision: string
}

export interface ToolDef {
	name: string
	description: string
	maxTokens: number
	modelName: string
	modelProvider: boolean
	jsonResponse: boolean
	temperature: number
	cache?: boolean
	chat: boolean
	internalPrompt: boolean
	arguments: ArgumentSchema
	tools: string[]
	globalTools: string[]
	context: string[]
	export: string[]
	blocking: boolean
	instructions: string
}

export interface ToolReference {
	named: string
	reference: string
	arg: string
	toolID: string
}

export interface Tool extends ToolDef {
	id: string
	type: "tool"
	toolMapping: Record<string, ToolReference[]>
	localTools: Record<string, string>
	source: SourceRef
	workingDir: string
}

export interface SourceRef {
	location: string
	lineNo: number
	repo?: Repo
}

export interface Text {
	id: string
	type: "text"
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
	inputContext: InputContext[]
	toolCategory?: string
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

export type Frame = RunFrame | CallFrame

export interface AuthResponse {
	id: string
	accept: boolean
	message?: string
}

function getCmdPath(): string {
	if (process.env.GPTSCRIPT_BIN) {
		return process.env.GPTSCRIPT_BIN
	}

	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "gptscript")
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

function toolArrayToContents(toolArray: ToolDef[]) {
	return toolArray.map(singleTool => {
		return toolDefToString(singleTool)
	}).join("\n---\n")
}

function toolDefToString(tool: ToolDef) {
	let toolInfo: string[] = []
	if (tool.name) {
		toolInfo.push(`Name: ${tool.name}`)
	}
	if (tool.description) {
		toolInfo.push(`Description: ${tool.description}`)
	}
	if (tool.globalTools?.length) {
		toolInfo.push(`Global Tools: ${tool.globalTools.join(", ")}`)
	}
	if (tool.tools?.length > 0) {
		toolInfo.push(`Tools: ${tool.tools.join(", ")}`)
	}
	if (tool.context?.length > 0) {
		toolInfo.push(`Context: ${tool.context.join(", ")}`)
	}
	if (tool.export?.length > 0) {
		toolInfo.push(`Export: ${tool.export.join(", ")}`)
	}
	if (tool.maxTokens !== undefined) {
		toolInfo.push(`Max Tokens: ${tool.maxTokens}`)
	}
	if (tool.modelName) {
		toolInfo.push(`Model: ${tool.modelName}`)
	}
	if (tool.cache !== undefined && !tool.cache) {
		toolInfo.push("Cache: false")
	}
	if (tool.temperature !== undefined) {
		toolInfo.push(`Temperature: ${tool.temperature}`)
	}
	if (tool.jsonResponse) {
		toolInfo.push("JSON Response: true")
	}
	if (tool.arguments && tool.arguments.properties) {
		for (const [arg, desc] of Object.entries(tool.arguments.properties)) {
			toolInfo.push(`Args: ${arg}: ${desc.description}`)
		}
	}
	if (tool.internalPrompt) {
		toolInfo.push(`Internal Prompt: ${tool.internalPrompt}`)
	}
	if (tool.chat) {
		toolInfo.push("Chat: true")
	}

	if (tool.instructions) {
		toolInfo.push("")
		toolInfo.push(tool.instructions)
	}

	return toolInfo.join("\n")
}

function randomId(prefix: string): string {
	return prefix + Math.random().toString(36).substring(2, 12)
}
