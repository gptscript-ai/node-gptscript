import { StreamExecResult, StreamExecWithEventsResult } from "./exec";
import { Tool, FreeForm } from "./tool";

export function getCmdPath(): string;
export function toArgs(opts: Record<string, any>): string[];
export function cliArgBuilder(): string;
export function listTools(): Promise<string>;
export function listModels(): Promise<string[]>;
export function exec(tool: Tool | FreeForm | (Tool | FreeForm)[], opts: { [key: string]: string }): Promise<string>;
export function execFile(scriptPath: string, input: string, opts: { [key: string]: string }): Promise<string>;
export function streamExec(tool: Tool | FreeForm | (Tool | FreeForm)[], opts: { [key: string]: string }): StreamExecResult;
export function streamExecWithEvents(tool: Tool | FreeForm | (Tool | FreeForm)[], opts: { [key: string]: string }): StreamExecWithEventsResult;
export function streamExecFile(scriptPath: string, input: string, opts: { [key: string]: string }): StreamExecResult;
export function streamExecFileWithEvents(tool: Tool | FreeForm | (Tool | FreeForm)[], opts: { [key: string]: string }): StreamExecWithEventsResult;