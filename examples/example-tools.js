import * as gptscript from "../dist/gptscript.js";

(async () => {
    try {
        const client = new gptscript.Client(process.env.GPTSCRIPT_URL)
        const response = await client.listTools();
        console.log(response)
    } catch (error) {
        console.error(error)
    }
})()
