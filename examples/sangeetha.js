import * as gptscript from '../dist/gptscript.js';

const opts = {
    disableCache: true
};

const client = new gptscript.Client()
const t = {
    chat: true,
    tools: ["sys.chat.finish", "github.com/gptscript-ai/search/duckduckgo", "sys.http.html2text?"],
    instructions: "You are a chat bot. Don't finish the conversation until I say 'bye'.Search using duckduckgo. If the search tool fails to return any information stop execution of the script with message 'Sorry! Search dis not retrun any results' .Feel free to get the contents of the returned URLs in order to get more information. Provide as much detail as you can.Search for who won superbowl 2024"
};

streamExecFileWithEvents()

async function streamExecFileWithEvents() {
    let i = 0;
    const chats = ["where was this game played?", "when and where was this game played last year?", "who was the winner of this game", "bye"];
    let run = client.evaluate(t, opts);
    try {
        // Wait for the initial run to complete.
        console.log(await run.text())

        while (run.state === gptscript.RunState.Continue) {
            // ...Get the next input from the user somehow...

            run = run.nextChat(chats[i++])

            // Get the output from gptscript
            const output = await run.text()
            console.log(output)
        }
    } catch (e) {
        console.log("ERROR")
        console.error(e);
    }

    // The state here should either be RunState.Finished (on success) or RunState.Error (on error).
    console.log(run.state)
}