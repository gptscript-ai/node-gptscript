// @ts-ignore
import type {SSE} from "sse.js"

export interface RunOpts {
	gptscriptURL?: string
	input?: string
	cacheDir?: string
	disableCache?: boolean
	quiet?: boolean
	chdir?: string
	subTool?: string
}

function toArgs(opts: RunOpts): string[] {
	const args: string[] = []
	const optToArg: Record<string, string> = {
		disableCache: "--disable-cache=",
		cacheDir: "--cache-dir=",
		quiet: "--quiet=",
		chdir: "--chdir=",
		subTool: "--sub-tool=",
	}
	for (const [key, value] of Object.entries(opts)) {
		if (optToArg[key] && value !== undefined) {
			args.push(optToArg[key] + value)
		}
	}

	return args
}

export enum RunEventType {
	Event = "event",
	RunStart = "runStart",
	RunFinish = "runFinish",
	CallStart = "callStart",
	CallChat = "callChat",
	CallProgress = "callProgress",
	CallContinue = "callContinue",
	CallFinish = "callFinish",
}

export class Run {
	public readonly id: string
	public readonly opts: RunOpts
	public state: RunState = RunState.Creating
	public calls: Call[] = []
	public err = ""
	public readonly filePath: string
	public readonly content: string
	protected stdout?: string
	private readonly requestPath: string = ""
	private promise?: Promise<string>
	private process?: any
	private sse?: SSE
	private req?: any
	private stderr?: string
	private callbacks: Record<string, ((f: Frame) => void)[]> = {}
	private chatState: string | undefined

	constructor(subCommand: string, path: string, content: string, opts: RunOpts) {
		this.id = randomId("run-")
		this.requestPath = subCommand
		this.opts = opts
		this.filePath = path
		this.content = content
	}

	nextChat(input: string = ""): Run {
		if (this.state === RunState.Finished || this.state === RunState.Error) {
			throw (new Error("Run already finished"))
		}

		let run = this
		if (run.state !== RunState.Creating) {
			run = new (this.constructor as any)(run.requestPath, run.filePath, run.content, run.opts)
		}

		run.chatState = this.chatState
		run.opts.input = input
		if (run.opts.gptscriptURL) {
			if (run.content !== "") {
				run.request({content: this.content})
			} else {
				run.request({file: this.filePath})
			}
		} else {
			run.exec().catch((e) => {
					run.state = RunState.Error
					run.err = e.toString()
				}
			)
		}

		return run
	}

	async exec(extraArgs: string[] = [], env: NodeJS.Dict<string> = process.env) {
		extraArgs.push(...toArgs(this.opts))
		extraArgs.push("--chat-state=" + (this.chatState ? JSON.stringify(this.chatState) : "null"))
		this.chatState = undefined

		if (this.filePath) {
			extraArgs.push(this.filePath)
		}
		if (this.content) {
			extraArgs.push("-")
		}

		if (this.opts.input) {
			extraArgs.push(this.opts.input)
		}

		this.promise = new Promise(async (resolve, reject) => {
			const net = await import("net")
			const spawnOptions = {env, stdio: ["pipe", "pipe", "pipe"]}
			const server = net.createServer((connection) => {
				console.debug("Client connected")

				connection.on("data", (data) => {
					this.emitEvent(data.toString())
				})

				connection.on("end", () => {
					server.close()
				})
			})


			// On Windows, the child process doesn't know which file handles are available to it.
			// Therefore, we have to use a named pipe. This is set up with a server.
			if (process.platform === "win32") {
				const namedPipe = "\\\\.\\pipe\\gptscript-" + Math.floor(Math.random() * 1000000)
				server.listen(namedPipe, () => {
					console.debug("Server is listening on", namedPipe)
				})

				// Add the named pipe for streaming events.
				extraArgs.unshift("--events-stream-to=" + namedPipe)
			} else {
				// For non-Windows systems, we just add an extra stdio pipe and use that for streaming events.
				spawnOptions.stdio.push("pipe")
				extraArgs.unshift("--events-stream-to=fd://" + (spawnOptions.stdio.length - 1))
			}


			const child_process = await import("child_process")

			this.process = child_process.spawn(await getCmdPath(), extraArgs, spawnOptions as any)
			if (process.platform !== "win32") {
				// We don't need the named pipe for streaming events.
				server.close()

				// If the child process is not a Windows system, we can use the stdio pipe for streaming events.
				if (this.process && this.process.stdio) {
					const pipe = this.process.stdio[this.process.stdio.length - 1]
					if (pipe) {
						pipe.on("data", (data: any) => {
							this.emitEvent(data.toString())
						})
					} else {
						console.error("Failed to get event stream")
					}
				}
			}

			if (!this.process) {
				this.state = RunState.Error
				this.err = "Run failed to start"
				server.close()
				this.promise = Promise.reject(this.err)
				return
			}

			// Write to stdin if provided
			if (this.process && this.process.stdin) {
				this.process.stdin.setDefaultEncoding("utf-8")
				if (this.content) {
					this.process.stdin.write(this.content)
				}
				this.process.stdin.end()
			}

			this.state = RunState.Running

			if (this.process.stdout) {
				this.process.stdout.on("data", (data: any) => {
					this.processStdout(data.toString())
				})
			}

			if (this.process.stderr) {
				this.process.stderr.on("data", (data: any) => {
					this.stderr = (this.stderr || "") + data
				})
			}

			this.process!.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
				server.close()

				if (signal) {
					this.state = RunState.Error
					this.err = "Run has been aborted"
				} else if (code !== 0) {
					this.state = RunState.Error
					this.err = this.stderr || ""
				} else if (this.state !== RunState.Continue) {
					this.state = RunState.Finished
				}

				if (this.err) {
					this.state = RunState.Error
					reject(this.err)
				} else {
					resolve(this.stdout || "")
				}
			})
		})
	}

	processStdout(data: string | object): void {
		if (typeof data === "string") {
			if (data.trim() === "") {
				return
			}

			try {
				data = JSON.parse(data)
			} catch (e) {
				this.err = `Failed to parse stdout: "${data}"`
				return
			}
		}

		const out = data as ChatState
		if (out.done !== undefined && !out.done) {
			this.chatState = out.state
			this.state = RunState.Continue
		} else {
			this.state = RunState.Finished
			this.chatState = undefined
		}
	}

	request(tool: any) {
		if (!this.opts.gptscriptURL) {
			throw new Error("request() requires gptscriptURL to be set")
		}
		const postData = JSON.stringify({...tool, ...this.opts})
		const options = this.requestOptions(this.opts.gptscriptURL, this.requestPath, postData, tool)

		this.promise = new Promise<string>(async (resolve, reject) => {
			// This checks that the code is running in a browser. If it is, then we use SSE.
			if (typeof window !== "undefined" && typeof window.document !== "undefined") {
				// @ts-ignore
				const {SSE} = await import("sse.js")
				this.sse = new SSE(this.opts.gptscriptURL + "/" + this.filePath, {
					headers: {"Content-Type": "application/json"},
					payload: postData
				} as any)

				this.sse.addEventListener("open", () => {
					this.state = RunState.Running
				})

				this.sse.addEventListener("message", (data: any) => {
					if (data.data === "[DONE]") {
						this.sse!.close()
						return
					}

					const e = JSON.parse(data.data)
					if (e.stderr) {
						this.stderr = (this.stderr || "") + (typeof e.stderr === "string" ? e.stderr : JSON.stringify(e.stderr))
					} else if (e.stdout) {
						this.stdout = (this.stdout || "") + (typeof e.stdout === "string" ? e.stdout : JSON.stringify(e.stdout))
					} else {
						this.emitEvent(data.data)
					}
				})

				this.sse.addEventListener("close", () => {
					if (this.state === RunState.Running || this.state === RunState.Finished) {
						this.state = RunState.Finished
						resolve(this.stdout || "")
					} else if (this.state === RunState.Error) {
						reject(this.err)
					}
				})

				this.sse.addEventListener("error", (err: any) => {
					this.state = RunState.Error
					this.err = err
					reject(err)
				})
			} else {
				// If not in the browser, then we use HTTP.
				const http = await import("http")

				// Use frag to keep track of partial object writes.
				let frag = ""
				this.req = http.request(options, (res: any) => {
					this.state = RunState.Running
					res.on("data", (chunk: any) => {
						for (let line of (chunk.toString() + frag).split("\n")) {
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
							frag = ""

							if (e.stderr) {
								this.stderr = (this.stderr || "") + (typeof e.stderr === "string" ? e.stderr : JSON.stringify(e.stderr))
							} else if (e.stdout) {
								this.processStdout(e.stdout)
							} else {
								frag = this.emitEvent(c)
							}
						}
					})

					res.on("end", () => {
						if (this.state === RunState.Running || this.state === RunState.Finished) {
							this.state = RunState.Finished
							resolve(this.stdout || "")
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

				this.req.write(postData)
				this.req.end()
			}
		})
	}

	requestOptions(gptscriptURL: string, path: string, postData: string, tool: any) {
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
				"Content-Type": "application/json",
				"Content-Length": postData.length
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
				f = JSON.parse(event) as Frame
			} catch (error) {
				return event
			}

			if (!this.state) {
				this.state = RunState.Creating
			}

			if (f.type === RunEventType.RunStart) {
				this.state = RunState.Running
			} else if (f.type === RunEventType.RunFinish) {
				if (f.err) {
					this.state = RunState.Error
					this.err = f.err || ""
				} else {
					this.state = RunState.Finished
					this.stdout = f.output || ""
				}
			} else if ((f.type as string).startsWith("call")) {
				let call = this.calls?.find((x) => x.id === f.callContext.id)

				if (!call) {
					call = {
						id: f.callContext.id,
						parentID: f.callContext.parentID,
						tool: f.callContext.tool,
						messages: [],
						state: RunState.Running,
						chatCompletionId: f.callContext.chatCompletionId,
						chatRequest: f.callContext.chatRequest,
					}

					this.calls?.push(call)
				}

				if (f.type === RunEventType.CallStart) {
					call.state = RunState.Creating
					call.input = f.content || ""
				} else if (f.type === RunEventType.CallChat) {
					call.state = RunState.Running

					if (f.chatRequest) {
						const more = (f.chatRequest.messages || []).slice(call.messages.length)

						call.messages.push(...more)
					}

					if (f.chatResponse) {
						call.messages.push(f.chatResponse)
					}
				} else if (f.type === RunEventType.CallContinue) {
					call.state = RunState.Running
				} else if (f.type === RunEventType.CallProgress) {
					call.state = RunState.Running

					call.output = f.content
				} else if (f.type === RunEventType.CallFinish) {
					call.state = RunState.Finished
					call.output = f.content
				}
			}

			this.emit(RunEventType.Event, f)
			this.emit(f.type, f)
		}

		return ""
	}

	public on(event: RunEventType.RunStart, listener: (data: RunStartFrame) => void): this;
	public on(event: RunEventType.RunFinish, listener: (data: RunFinishFrame) => void): this;
	public on(event: RunEventType.CallStart, listener: (data: CallStartFrame) => void): this;
	public on(event: RunEventType.CallChat, listener: (data: CallChatFrame) => void): this;
	public on(event: RunEventType.CallContinue, listener: (data: CallContinueFrame) => void): this;
	public on(event: RunEventType.CallProgress, listener: (data: CallProgressFrame) => void): this;
	public on(event: RunEventType.CallFinish, listener: (data: CallFinishFrame) => void): this;
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

	public close(): void {
		if (this.process) {
			if (this.process.exitCode === null) {
				this.process.kill("SIGKILL")
			}
			return
		}

		if (this.req) {
			this.req.destroy()
			return
		}

		if (this.sse) {
			this.sse.close()
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
	constructor(subCommand: string, path: string, content: string, opts: RunOpts) {
		super(subCommand, path, content, opts)
	}

	processStdout(data: string | object) {
		if (typeof data === "string") {
			this.stdout = (this.stdout || "") + data
		} else {
			this.stdout = JSON.stringify(data)
		}
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
	export: string[]
	blocking: boolean
	instructions: string
}

export interface Tool extends ToolDef {
	id: string
	type: "tool"
	toolMapping: Record<string, string>
	localTools: Record<string, string>
	source: SourceRef
	workingDir: string
}

export interface SourceRef {
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

export interface Call {
	id: string
	parentID?: string
	chatCompletionId?: string
	state: RunState
	messages: ChatMessage[]
	tool?: Tool
	chatRequest?: Record<string, any>
	input?: Arguments
	output?: string
	showSystemMessages?: boolean
}

interface BaseFrame {
	type: RunEventType
	time: string
	runID: string
}

interface CallFrame extends BaseFrame {
	callContext: Call
	input: Arguments
}

export interface RunStartFrame extends BaseFrame {
	type: RunEventType.RunStart
	program: Program
}

export interface RunFinishFrame extends BaseFrame {
	type: RunEventType.RunFinish
	input: Arguments

	err?: string
	output?: string
}

export interface CallStartFrame extends CallFrame {
	type: RunEventType.CallStart
	content: string
}

export interface CallChatFrame extends CallFrame {
	type: RunEventType.CallChat
	chatCompletionId: string
	chatRequest?: ChatRequest
	chatResponse?: ChatMessage
	chatResponseCached?: boolean
}

export interface CallProgressFrame extends CallFrame {
	type: RunEventType.CallProgress
	chatCompletionId: string
	content: string
}

export interface CallContinueFrame extends CallFrame {
	type: RunEventType.CallContinue
	toolResults: number
}

export interface CallFinishFrame extends CallFrame {
	type: RunEventType.CallFinish
	content: string
}

export type Frame =
	RunStartFrame
	| RunFinishFrame
	| CallStartFrame
	| CallChatFrame
	| CallProgressFrame
	| CallContinueFrame
	| CallFinishFrame

export interface ChatRequest {
	max_tokens: number
	messages: ChatMessage[]
	model: string
	temperature: string
	tools?: ChatTool[]
}

export interface ChatText {
	text: string
}

export interface ChatToolCall {
	toolCall: {
		id: string
		index: number
		type: "function"
		function: {
			name: string
			arguments: string
		}
	}
}

enum ChatMessageRole {
	System = "system",
	Assistant = "assistant",
	User = "user",
	Tool = "tool"
}

export interface ChatToolMessage {
	role: ChatMessageRole
	content: string | (ChatToolCall | ChatText)[]
}

export interface ChatErrorMessage {
	err: string
}

export interface ChatOutputMessage {
	output: string
}

export type ChatMessage = ChatToolMessage | ChatOutputMessage | ChatErrorMessage

export interface ChatToolFunction {
	type: "function"
	function: {
		name: string
		description: string
		parameters: {
			type: "object"
			properties: Record<string, ChatProperty>
		}
	}
}

export type ChatTool = ChatToolFunction

export interface ChatProperty {
	type: string
	description: string
}

async function getCmdPath(): Promise<string> {
	if (process.env.GPTSCRIPT_BIN) {
		return process.env.GPTSCRIPT_BIN
	}

	const path = await import("path")
	return path.join(__dirname, "..", "bin", "gptscript")
}

export function listTools(gptscriptURL?: string): Promise<string> {
	return runBasicCommand("list-tools", gptscriptURL)
}

export function listModels(gptscriptURL?: string): Promise<string> {
	return runBasicCommand("list-models", gptscriptURL)
}

export function version(gptscriptURL?: string): Promise<string> {
	return runBasicCommand("version", gptscriptURL)
}

async function runBasicCommand(cmd: string, gptscriptURL?: string): Promise<string> {
	const r = new RunSubcommand(cmd, "", "", {gptscriptURL: gptscriptURL})
	if (gptscriptURL) {
		r.request(null)
	} else {
		await r.exec(["--" + cmd])
	}
	return r.text()
}

/**
 * Runs a tool with the specified name and options.
 *
 * @param {string} toolName - The name of the tool to run. Can be a file path, URL, or GitHub URL.
 * @param {RunOpts} [opts={}] - The options for running the tool.
 * @return {Run} The Run object representing the running tool.
 */
export function run(toolName: string, opts: RunOpts = {}): Run {
	return (new Run("run-file-stream-with-events", toolName, "", opts)).nextChat(opts.input)
}

/**
 * Evaluates the given tool and returns a Run object.
 *
 * @param {ToolDef | ToolDef[] | string} tool - The tool to be evaluated. Can be a single ToolDef object, an array of ToolDef objects, or a string representing the tool contents.
 * @param {RunOpts} [opts={}] - Optional options for the evaluation.
 * @return {Run} The Run object representing the evaluation.
 */
export function evaluate(tool: ToolDef | ToolDef[] | string, opts: RunOpts = {}): Run {
	let toolString: string = ""

	if (Array.isArray(tool)) {
		toolString = toolArrayToContents(tool)
	} else if (typeof tool === "string") {
		toolString = tool
	} else {
		toolString = toolDefToString(tool)
	}

	return (new Run("run-tool-stream-with-event", "", toolString, opts)).nextChat(opts.input)
}

export async function parse(fileName: string, gptscriptURL?: string): Promise<Block[]> {
	const r: Run = new RunSubcommand("parse", fileName, "", {gptscriptURL: gptscriptURL})
	if (gptscriptURL) {
		r.request({file: fileName})
	} else {
		await r.exec(["parse"])
	}
	return parseBlocksFromNodes((await r.json()).nodes)
}

export async function parseTool(toolContent: string, gptscriptURL?: string): Promise<Block[]> {
	const r: Run = new RunSubcommand("parse", "", toolContent, {gptscriptURL: gptscriptURL})
	if (gptscriptURL) {
		r.request({input: toolContent})
	} else {
		await r.exec(["parse"])
	}
	return parseBlocksFromNodes((await r.json()).nodes)
}

export async function stringify(blocks: Block[], gptscriptURL?: string): Promise<string> {
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

	const r: Run = new RunSubcommand("fmt", "", JSON.stringify({nodes: nodes}), {gptscriptURL: gptscriptURL})
	if (gptscriptURL) {
		r.request({nodes: nodes})
	} else {
		await r.exec(["fmt"])
	}

	return r.text()
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
