import * as gptscript from "../dist/gptscript.js";
import * as readline from "readline";
import {stdin as input, stdout as output} from 'node:process';

const client = new gptscript.Client(process.env.GPTSCRIPT_URL)

const rl = readline.createInterface({input, output});

const t = {
    chat: true,
    tools: ["sys.chat.finish"],
    instructions: "Say hello and start a chat session.",
};

let r = client.evaluate(t, {
    disableCache: true,
});

(async () => {
    r.on(gptscript.RunEventType.Event, (data) => {
        console.log(JSON.stringify(data))
    })
    console.log(await r.text());
    const recursiveAsyncReadLine = function () {
        rl.question(`>> `, async function (answer) {
            if (answer === "") //we need some base case, for recursion
                return rl.close(); //closing RL and returning from function.
            try {
                r = r.nextChat(answer);
            } catch (e) {
                console.error(e);
            }
            console.log(await r.text());
            console.log(r.state);
            if (r.state === gptscript.RunState.Finished) {
                console.log("The conversation is finished. Goodbye!");
                return rl.close();
            }
            recursiveAsyncReadLine(); //Calling this function again to ask new question
        });
    };

    recursiveAsyncReadLine();
})()

rl.on("close", function () {
    console.log("\nBYE BYE !!!");
    process.exit(0);
});
