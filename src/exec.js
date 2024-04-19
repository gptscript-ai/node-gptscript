const childProcess = require('child_process');
const net = require('net');
const stream = require('stream');
const TEN_MEBIBYTE = 1024 * 1024 * 10;


async function exec(command, args, stdin, cwd = './', detached, env) {
    let stdout = '';
    let stderr = '';

    const spawnOptions = { maxBuffer: TEN_MEBIBYTE, cwd, detached, env };

    const child = childExec(command, args, stdin, spawnOptions);

    // Capture stdout
    child.stdout.on('data', data => {
        stdout += data;
    });

    // Capture stderr
    child.stderr.on('data', data => {
        stderr += data;
    });

    // Wait for the child process to exit
    await new Promise((resolve, reject) => {
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(stderr));
            } else {
                resolve();
            }
        });

        // Handle process error event
        child.on('error', error => {
            reject(error);
        });
    });

    return stdout;
}

async function streamExec(command, args, stdin, cwd = './', detached, env) {
    const spawnOptions = { maxBuffer: TEN_MEBIBYTE, cwd, detached, env };

   const child = childExec(command, args, stdin, spawnOptions);

   return {
       stdout: child.stdout,
       stderr: child.stderr,
       promise: new Promise((resolve, reject) => {
           child.on('close', code => {
               if (code !== 0) {
                   reject(new Error(`Child process exited with code ${code}`));
               } else {
                   resolve();
               }
           });

           child.on('error', error => {
               reject(error);
           });
       })
   }
}

async function streamExecWithEvents(command, args, stdin, cwd = './', env) {
    let server, events = null;
    const spawnOptions = { maxBuffer: TEN_MEBIBYTE, cwd, env, stdio: ['pipe', 'pipe', 'pipe'] };

    // On Windows, the child process doesn't know which file handles are available to it.
    // Therefore, we have to use a named pipe. This is set up with a server.
    if (process.platform === 'win32') {
        const namedPipe = '\\\\.\\pipe\\gptscript-' + Math.floor(Math.random() * 1000000);
        events = new stream.Readable({
            encoding: 'utf-8',
            read() {
            }
        });

         server = net.createServer((connection) => {
            console.debug('Client connected');

            connection.on('data', (data) => {
                // Pass the data onto the event stream.
                events.push(data);
            });

            connection.on('end', () => {
                // Indicate that there is no more data.
                events.push(null);
            });
        });

        server.listen(namedPipe, () => {
            console.debug('Server is listening on', namedPipe);
        });

        // Add the named pipe for streaming events.
        args.unshift("--events-stream-to="+namedPipe);
    } else {
        // For non-Windows systems, we just add an extra stdio pipe and use that for streaming events.
        spawnOptions.stdio.push('pipe');
        args.unshift("--events-stream-to=fd://"+(spawnOptions.stdio.length-1));
    }


    const child = childExec(command, args, stdin, spawnOptions);
    if (!events) {
        // If the child process is not a Windows system, we can use the stdio pipe for streaming events.
        events = stream.Readable.from(child.stdio[child.stdio.length-1])
    }

    return {
        stdout: child.stdout,
        stderr: child.stderr,
        events: events,
        promise: new Promise((resolve, reject) => {
            child.on('exit', code => {
                events.destroy();
                if (server) server.close();

                if (code !== 0) {
                    reject(new Error(`Child process exited with code ${code}`));
                } else {
                    resolve();
                }
            });

            child.on('error', error => {
                events.destroy();
                if (server) server.close();

                reject(error);
            });
        })
    };
}

function childExec(command, args, stdin, opts = {}) {
    const child = childProcess.spawn(command, args, opts);

    // Write to stdin if provided
    if (stdin && child.stdin) {
        child.stdin.setDefaultEncoding('utf-8');
        child.stdin.write(stdin);
        child.stdin.end();
    }

    return child;
}


module.exports = {
    exec: exec,
    streamExec: streamExec,
    streamExecWithEvents: streamExecWithEvents
}
