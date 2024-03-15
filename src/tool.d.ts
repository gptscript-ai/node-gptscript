// Define interfaces for constructor options
interface ToolOptions {
    name?: string;
    description?: string;
    tools?: string[];
    maxTokens?: number | undefined;
    model?: string;
    cache?: boolean;
    temperature?: number | undefined;
    args?: Record<string, any>;
    internalPrompt?: string;
    instructions?: string;
    jsonResponse?: boolean;
}

interface FreeFormOptions {
    content?: string;
}

// Type definitions for the Tool class
export class Tool {
    constructor(options?: ToolOptions);
    name: string;
    description: string;
    tools: string[];
    maxTokens: number | undefined;
    model: string;
    cache: boolean;
    temperature: number | undefined;
    args: Record<string, any>;
    internalPrompt: string;
    instructions: string;
    jsonResponse: boolean;

    toString(): string;
}

// Type definitions for the FreeForm class
export class FreeForm {
    constructor(options?: FreeFormOptions);
    content: string;

    toString(): string;
}
