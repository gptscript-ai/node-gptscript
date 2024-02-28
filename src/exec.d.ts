import { Readable } from 'stream';
export function exec(command: string, args: string[], stdin: string, cwd: string, detached: boolean, env: { [key: string]: string }): Promise<string>;
interface StreamExecResult {
    stdout: Readable;
    stderr: Readable;
    promise: Promise<void>;
}

export function streamExec(command: string, args: string[], stdin: string, cwd: string, detached: boolean, env: { [key: string]: string }): StreamExecResult;