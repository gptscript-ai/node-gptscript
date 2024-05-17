import * as gptscript from "../dist/gptscript.js";

(async () => {
    try {
        const client = new gptscript.Client(process.env.GPTSCRIPT_URL)
        const response = await client.parseTool("hello world");
        console.log(JSON.stringify(response));
    } catch (error) {
        console.error(error);
    }
})();
