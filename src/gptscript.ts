import * as path from "path"
import child_process from "child_process"
import net from "node:net"
import http from "http"

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
	public readonly path: string

	private promise?: Promise<string>
	private process?: child_process.ChildProcess
	private req?: http.ClientRequest
	private stdout?: string
	private stderr?: string
	private callbacks: Record<string, ((f: Frame) => void)[]> = {}

	constructor(path: string, opts: RunOpts) {
		this.id = randomId("run-")
		this.opts = opts
		this.path = path
	}

	exec(command: string, args: string[], stdin: string = "", env: NodeJS.Dict<string> = process.env): void {
		if (this.path) {
			args.push(this.path)
		}
		if (this.opts.input) {
			args.push(this.opts.input)
		}

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
			args.unshift("--events-stream-to=" + namedPipe)
		} else {
			// For non-Windows systems, we just add an extra stdio pipe and use that for streaming events.
			spawnOptions.stdio.push("pipe")
			args.unshift("--events-stream-to=fd://" + (spawnOptions.stdio.length - 1))
		}


		this.process = child_process.spawn(command, args, spawnOptions as any)
		if (process.platform !== "win32") {
			// We don't need the named pipe for streaming events.
			server.close()

			// If the child process is not a Windows system, we can use the stdio pipe for streaming events.
			if (this.process && this.process.stdio) {
				const pipe = this.process.stdio[this.process.stdio.length - 1]
				if (pipe) {
					pipe.on("data", (data) => {
						this.emitEvent(data.toString())
					})
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
			if (stdin) {
				this.process.stdin.write(stdin)
			}
			this.process.stdin.end()
		}

		this.state = RunState.Running

		if (this.process.stdout) {
			this.process.stdout.on("data", data => {
				this.stdout = (this.stdout || "") + data
			})
		}

		if (this.process.stderr) {
			this.process.stderr.on("data", data => {
				this.stderr = (this.stderr || "") + data
			})
		}
		this.promise = new Promise((resolve, reject) => {
			this.process!.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
				server.close()

				if (signal) {
					this.state = RunState.Error
					this.err = "Run has been aborted"
				} else if (code !== 0) {
					this.state = RunState.Error
					this.err = this.stderr || ""
				} else {
					this.state = RunState.Finished
				}

				if (this.err) {
					reject(this.err)
				} else {
					resolve(this.stdout || "")
				}
			})
		})
	}

	request(path: string, tool: any): void {
		if (!this.opts.gptscriptURL) {
			throw new Error("request() requires gptscriptURL to be set")
		}
		const postData = JSON.stringify({...tool, ...this.opts})
		const options = this.requestOptions(this.opts.gptscriptURL, path, postData, tool)

		this.promise = new Promise<string>((resolve, reject) => {
			// Use frag to keep track of partial object writes.
			let frag = ""
			this.req = http.request(options, (res: http.IncomingMessage) => {
				this.state = RunState.Running
				res.on("data", (chunk: any) => {
					const c = chunk.toString().replace(/^(data: )/, "").trim()
					if (c === "[DONE]") {
						return
					}

					let e: any
					try {
						e = JSON.parse(frag + c)
					} catch {
						frag += c
						return
					}
					frag = ""

					if (e.stderr) {
						this.stderr = (this.stderr || "") + (typeof e.stderr === "string" ? e.stderr : JSON.stringify(e.stderr))
					} else if (e.stdout) {
						this.stdout = (this.stdout || "") + (typeof e.stdout === "string" ? e.stdout : JSON.stringify(e.stdout))
					} else {
						frag = this.emitEvent(frag + c)
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
			} else if (f.type.startsWith("call")) {
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

	public abort(): void {
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

		throw new Error("Run not started")
	}

	private emit(event: RunEventType, data: any) {
		for (const cb of this.callbacks[event] || []) {
			cb(data)
		}
	}
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

function getCmdPath(): string {
	if (process.env.GPTSCRIPT_BIN) {
		return process.env.GPTSCRIPT_BIN
	}
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

function runBasicCommand(cmd: string, gptscriptURL?: string): Promise<string> {
	const r = new Run("", {gptscriptURL: gptscriptURL})
	if (gptscriptURL) {
		r.request(cmd, null)
	} else {
		r.exec(getCmdPath(), ["--" + cmd])
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
	const r: Run = new Run(toolName, opts)

	if (opts.gptscriptURL) {
		r.request("run-file-stream-with-events", {file: toolName, input: opts.input})
	} else {
		r.exec(getCmdPath(), toArgs(opts))
	}

	return r
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

	const r: Run = new Run("", opts)
	if (opts.gptscriptURL) {
		r.request("run-tool-stream-with-events", {content: toolString})
	} else {
		const args = toArgs(opts)
		args.push("-")
		r.exec(getCmdPath(), args, toolString)
	}

	return r
}

export async function parse(fileName: string, gptscriptURL?: string): Promise<Block[]> {
	const r: Run = new Run(fileName, {gptscriptURL: gptscriptURL})
	if (gptscriptURL) {
		r.request("parse", {file: fileName})
	} else {
		r.exec(getCmdPath(), ["parse"])
	}

	return parseBlocksFromNodes((await r.json()).nodes)
}

export async function parseTool(toolContent: string, gptscriptURL?: string): Promise<Block[]> {
	const r: Run = new Run("", {gptscriptURL: gptscriptURL})
	if (gptscriptURL) {
		r.request("parse", {input: toolContent})
	} else {
		r.exec(getCmdPath(), ["parse", "-"], toolContent)
	}
	return parseBlocksFromNodes((await r.json()).nodes)
}

export function stringify(blocks: Block[], gptscriptURL?: string): Promise<string> {
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

	const r: Run = new Run("", {gptscriptURL: gptscriptURL})
	if (gptscriptURL) {
		r.request("fmt", {nodes: nodes})
	} else {
		r.exec(getCmdPath(), ["fmt", "-"], JSON.stringify({nodes: nodes}))
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

	if (tool.instructions) {
		toolInfo.push("")
		toolInfo.push(tool.instructions)
	}

	return toolInfo.join("\n")
}

function randomId(prefix: string): string {
	return prefix + Math.random().toString(36).substring(2, 12)
}
