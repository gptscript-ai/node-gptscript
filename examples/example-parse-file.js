import * as gptscript from "../dist/gptscript.js";

(async () => {
    try {
        const client = new gptscript.Client(process.env.GPTSCRIPT_URL)
        const response = await client.parse("/Users/thedadams/code/gptscript-examples/envvar.gpt");
        console.log(JSON.stringify(response));
    } catch (error) {
        console.error(error);
    }
})();
