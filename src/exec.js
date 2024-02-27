const childProcess = require('child_process');

const TEN_MEBIBYTE = 1024 * 1024 * 10

async function exec(command, args, stdin, cwd = './', detached, env) {
    let stdout = '';
    let stderr = '';

    const spawnOptions = { maxBuffer: TEN_MEBIBYTE, cwd, detached, env };

    const child = childProcess.spawn(command, args, spawnOptions);

    // Capture stdout
    child.stdout.on('data', data => {
        stdout += data;
    });

    // Capture stderr
    child.stderr.on('data', data => {
        stderr += data;
    });

    // Write to stdin if provided
    if (stdin) {
        child.stdin.setEncoding('utf-8');
        child.stdin.write(stdin);
        child.stdin.end();
    }

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

module.exports = exec
