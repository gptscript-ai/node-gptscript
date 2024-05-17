import * as gptscript from "../dist/gptscript.js";

(async () => {
    const testGptPath = `/Users/thedadams/code/gptscript-examples/envvar.gpt`;
    const opts = {
        disableCache: true
    }

    try {
        const client = new gptscript.Client(process.env.GPTSCRIPT_URL, process.env.GPTSCRIPT_BIN)
        const run = await client.run(testGptPath, opts);
        run.on(gptscript.RunEventType.Event, data => {
            console.log(`event: ${JSON.stringify(data)}`)
        });

        console.log(await run.text())
    } catch (e) {
        console.log(e)
        console.error(JSON.stringify(e));
    }
})();
