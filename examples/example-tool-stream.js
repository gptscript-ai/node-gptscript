import * as gptscript from "../dist/gptscript.js";

(async () => {
    try {
        const client = new gptscript.Client(process.env.GPTSCRIPT_URL)

        const t = {
            instructions: "who was the president of the united states in 1928?"
        }

        const r = client.evaluate(t, {
            disableCache: true
        })

        r.on(gptscript.RunEventType.Event, data => {
            console.log(`event: ${JSON.stringify(data)}`);
        });

        console.log(await r.text())
    } catch (e) {
        console.error(e)
    }
})()
