const gptscript = require('../src/gptscript');
const path = require('path');

describe('gptscript module', () => {

    beforeAll(() => {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error("OPENAI_API_KEY is not set");
        }
    });

    test('listTools returns available tools', async () => {
        const tools = await gptscript.listTools();
        expect(tools).toBeDefined();
    });

    test('listModels returns a list of models', async () => {
        // Similar structure to listTools
        let models = await gptscript.listModels();
        expect(models).toBeDefined();
        expect(Array.isArray(models)).toBe(true);
    });

    test('exec executes a prompt correctly', async () => {
        const t = new gptscript.Tool({
            instructions: "who was the president of the united states in 1928?"
        });

        const response = await gptscript.exec(t);
        expect(response).toBeDefined();
        expect(response).toContain("Calvin Coolidge");
    });

    test('streamExec executes a prompt correctly', async () => {
        let out = "";
        let err = "";
        const t = new gptscript.Tool({
            instructions: "who was the president of the united states in 1928?"
        });
        const opts = {
            cache: false
        }

        try {
            const { stdout, stderr, promise } = await gptscript.streamExec(t, opts);
            stdout.on('data', data => {
                out += `system: ${data}`;
            });
            stderr.on('data', data => {
                err += `system: ${data}`;
            });
            await promise;
        } catch (e) {
            console.error(e);
        }

        expect(out).toContain("Calvin Coolidge");
        expect(err).toContain("system: ");
    });

    test('streamExecWithEvents executes a prompt correctly', async () => {
        let out = "";
        let err = "";
        let event = "";
        const t = new gptscript.Tool({
            instructions: "who was the president of the united states in 1928?"
        });
        const opts = {
            cache: false
        }

        try {
            const { stdout, stderr, events, promise } = await gptscript.streamExecWithEvents(t, opts);
            stdout.on('data', data => {
                out += `system: ${data}`;
            });
            stderr.on('data', data => {
                err += `system: ${data}`;
            });
            events.on('data', data => {
                event += `events: ${data}`;
            })
            await promise;
        } catch (e) {
            console.error(e);
        }

        expect(out).toContain("Calvin Coolidge");
        expect(err).toContain("system: ");
        expect(event).toContain("events: ");
    });

    describe('execFile with test.gpt fixture', () => {
        test('should execute test.gpt correctly', async () => {
            const testGptPath = path.join(__dirname, 'fixtures', 'test.gpt');

            try {
                const result = await gptscript.execFile(testGptPath);
                expect(result).toBeDefined(); // Replace with more specific assertions based on your expectations
                expect(result).toContain("Calvin Coolidge");
            } catch (error) {
                console.error(error);
                fail('execFile threw an unexpected error.');
            }
        });
    });

    test('streamExecFile executes a prompt correctly', async () => {
        let out = "";
        let err = "";
        const testGptPath = path.join(__dirname, 'fixtures', 'test.gpt');
        const opts = {
            cache: false
        }

        try {
            const { stdout, stderr, promise } = await gptscript.streamExecFile(testGptPath, opts);
            stdout.on('data', data => {
                out += `system: ${data}`;
            });
            stderr.on('data', data => {
                err += `system: ${data}`;
            });
            await promise;
        } catch (e) {
            console.error(e);
        }

        expect(out).toContain("Calvin Coolidge");
        expect(err).toContain("system: ");
    });

    test('streamExecFileWithEvents executes a prompt correctly', async () => {
        let out = "";
        let err = "";
        let event = "";
        const testGptPath = path.join(__dirname, 'fixtures', 'test.gpt');
        const opts = {
            cache: false
        }

        try {
            const { stdout, stderr, events, promise } = await gptscript.streamExecFileWithEvents(testGptPath, opts);
            stdout.on('data', data => {
                out += `system: ${data}`;
            });
            stderr.on('data', data => {
                err += `system: ${data}`;
            });
            events.on('data', data => {
                event += `events: ${data}`;
            })
            await promise;
        } catch (e) {
            console.error(e);
        }

        expect(out).toContain("Calvin Coolidge");
        expect(err).toContain("system: ");
        expect(event).toContain("events: ");
    });

    test('exec of multiple tools', async () => {
        const t0 = new gptscript.Tool({
            tools: ["ask"],
            instructions: "Only use the ask tool to ask who was the president of the united states in 1928?"
        });
        const t1 = new gptscript.Tool({
            name: "ask",
            description: "This tool is used to ask a question",
            args: {
                question: "The question to ask"
            },
            instructions: "${question}"
        });

        const response = await gptscript.exec([t0, t1]);
        expect(response).toBeDefined();
        expect(response).toContain("Calvin Coolidge");
    }, 30000);
});
