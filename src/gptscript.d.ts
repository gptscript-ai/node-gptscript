import { StreamExecResult } from "./exec";

export function getCmdPath(): string;
export function toArgs(opts: Record<string, any>): string[];
export function cliArgBuilder(): string;
export function listTools(): Promise<string>;
export function listModels(): Promise<string[]>;
export function exec(prompt: string, opts: { [key: string]: string }): Promise<string>;
export function execFile(scriptPath: string, input: string, opts: { [key: string]: string }): Promise<string>;
export function streamExec(prompt: string, opts: { [key: string]: string }): StreamExecResult;
export function streamExecFile(scriptPath: string, input: string, opts: { [key: string]: string }): StreamExecResult;