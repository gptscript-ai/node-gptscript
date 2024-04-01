class Tool {
    constructor({
        name = "",
        description = "",
        tools = [],
        maxTokens = undefined, // Prefer `undefined` for uninitialized or optional values
        model = "",
        cache = true,
        temperature = undefined,
        args = {},
        internalPrompt = false,
        instructions = "",
        jsonResponse = false,
    } = {}) {
        this.name = name;
        this.description = description;
        this.tools = tools;
        this.maxTokens = maxTokens;
        this.model = model;
        this.cache = cache;
        this.temperature = temperature;
        this.args = args;
        this.internalPrompt = internalPrompt;
        this.instructions = instructions;
        this.jsonResponse = jsonResponse;
    }

    toString() {
        let toolInfo = [];
        if (this.name) {
            toolInfo.push(`Name: ${this.name}`);
        }
        if (this.description) {
            toolInfo.push(`Description: ${this.description}`);
        }
        if (this.tools.length > 0) {
            toolInfo.push(`Tools: ${this.tools.join(", ")}`);
        }
        if (this.maxTokens !== undefined) {
            toolInfo.push(`Max tokens: ${this.maxTokens}`);
        }
        if (this.model) {
            toolInfo.push(`Model: ${this.model}`);
        }
        if (!this.cache) {
            toolInfo.push("Cache: false");
        }
        if (this.temperature !== undefined) {
            toolInfo.push(`Temperature: ${this.temperature}`);
        }
        if (this.jsonResponse) {
            toolInfo.push("JSON Response: true");
        }
        Object.entries(this.args).forEach(([arg, desc]) => {
            toolInfo.push(`Args: ${arg}: ${desc}`);
        });
        if (this.internalPrompt) {
            toolInfo.push(`Internal prompt: ${this.internalPrompt}`);
        }
        if (this.instructions) {
            toolInfo.push(this.instructions);
        }

        return toolInfo.join('\n');
    }
}

class FreeForm {
    constructor({ content = "" } = {}) {
        this.content = content;
    }

    toString() {
        return this.content;
    }
}


module.exports = { Tool: Tool, FreeForm: FreeForm };