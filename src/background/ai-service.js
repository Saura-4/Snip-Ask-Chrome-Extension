// src/background/ai-service.js

// ============================================================================
// 1. PROMPT DEFINITIONS
//    These are the "instructions" for the AI. We keep them here so
//    background.js doesn't get cluttered.
// ============================================================================
const PROMPTS =
{
    short:
    {
        base: "You are a concise answer engine. Read the text below (it may come from OCR). Silently correct any minor recognition errors. Then OUTPUT ONLY ONE LINE in this EXACT FORMAT: Answer: <option letter>. <option text>. Do NOT output any other text, explanation, corrected text, suggestions, or meta-comments. If multiple questions appear, answer only the first. If none of the options match, respond exactly: Answer: Unknown.",
        image: "Analyze the image and give me the correct option with short explanation. Output ONLY in this format:\n**Answer:** [Correct Option/Value/Option Letter]\n**Why:** [One short explanation justifying the answer]. make sure the option is correct."
    },
    detailed:
    {
        base: "You are an expert tutor. Provide a step-by-step answer. Correct mistakes silently and never mention OCR.",
        image: "You are a tutor. Analyze the image in detail. Break down the solution step-by-step. If it's code, explain the logic. Use bolding and bullet points."
    },
    code:
    {
        base: "You are a code debugger and executor. Correct the code if needed, do not explain trivial OCR errors. Output EXACTLY this: 1) a single fenced code block containing the corrected code (```<lang> ... ```), then 2) a single line prefixed with 'Output:' showing what the program prints when run. Do NOT include any other commentary or mention OCR.",
        image: "You are a Code Linter. 1. Immediately provide the CORRECTED code block. 2. Underneath, explain exactly what caused the bug (1-2 sentences). Do not waste time with pleasantries."
    },
    // Default fallback
    default:
    {
        base: "Analyze the text and provide a helpful response.",
        image: "Analyze the image and provide a helpful response."
    }
};

// ============================================================================
// 2. ABSTRACT SERVICE (The "Contract")
//    Every new AI model you add (Gemini, OpenAI) MUST extend this class.
// ============================================================================
class AbstractAIService
{
    constructor(apiKey, modelName, interactionMode, customPrompt)
    {
        this.apiKey = apiKey;
        this.modelName = modelName;
        this.mode = interactionMode;
        this.customPrompt = customPrompt;
    }

    /**
     * Helper: wraps raw OCR text with strict instructions to fix errors silently.
     */
    _createTextPrompt(rawText)
    {
        let finalInstruction = PROMPTS.default.base;

        // 1. Select the base instruction based on mode
        if (this.mode === 'custom' && this.customPrompt)
        {
            finalInstruction = this.customPrompt;
        }
        else if (PROMPTS[this.mode])
        {
            finalInstruction = PROMPTS[this.mode].base;
        }

        // 2. Append the specific OCR Wrapper (The "Silent Correction" Protocol)
        const ocrWrapper =
            "The text below was extracted by an automated process and may contain recognition errors. " +
            "Silently correct any obvious recognition mistakes (spelling, symbol confusions) BEFORE answering. " +
            "Only include a single-line 'Corrected text: <text>' IF the correction materially changes the meaning (more than trivial spacing/punctuation fixes). " +
            "Do NOT mention OCR or the extraction process in any other way. Do NOT say 'the text seems clean' or similar. " +
            "Always prioritize a clear final answer for the user and keep extra commentary to a minimum.\n\n" +
            "=== BEGIN TEXT ===\n" +
            rawText +
            "\n=== END TEXT ===\n\n";

        return finalInstruction + "\n\n" + ocrWrapper;
    }

    /**
     * Helper: selects the correct prompt for image analysis.
     */
    _createImagePrompt()
    {
        if (this.mode === 'custom' && this.customPrompt)
        {
            return this.customPrompt;
        }
        return PROMPTS[this.mode]?.image || PROMPTS.short.image;
    }

    // --- Abstract Methods (Must be implemented by Subclasses) ---

    async askImage(base64Image)
    {
        throw new Error("Method 'askImage' must be implemented.");
    }

    async askText(text)
    {
        throw new Error("Method 'askText' must be implemented.");
    }
}

// ============================================================================
// 3. GROQ IMPLEMENTATION
//    The specific details for talking to Groq's API.
// ============================================================================
class GroqService extends AbstractAIService
{
    constructor(apiKey, modelName, interactionMode, customPrompt)
    {
        super(apiKey, modelName, interactionMode, customPrompt);
        // Default to Llama-4-Scout if no model provided
        this.actualModel = modelName || "meta-llama/llama-4-scout-17b-16e-instruct";
        this.API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
    }

    /**
     * Internal helper to perform the actual fetch request
     */
    async _makeApiCall(messagesBody)
    {
        const requestBody =
        {
            messages: messagesBody,
            model: this.actualModel,
            temperature: 0.1,
            max_tokens: 1024
        };

        const response = await fetch(this.API_ENDPOINT,
        {
            method: "POST",
            headers:
            {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok)
        {
            const errorMsg = data.error ? (data.error.message || JSON.stringify(data.error)) : "Network Error";
            throw new Error(errorMsg);
        }

        let answer =
            data.choices?.[0]?.message?.content ||
            data.choices?.[0]?.text ||
            "No answer returned.";

        // --- NEW: CLEANING FOR REASONING MODELS ---
        // If the model gave us <think> tags, remove them so the user 
        // only sees the final result (especially for 'Short' mode).
        // You can make this conditional (e.g., only if this.mode === 'short')
        if (answer.includes("<think>"))
        {
            answer = answer.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        }
        // ------------------------------------------

        return answer;
    }

    async askImage(base64Image)
    {
        const promptText = this._createImagePrompt();

        const messages = [
        {
            role: "user",
            content: [
            {
                type: "text",
                text: promptText
            },
            {
                type: "image_url",
                image_url:
                {
                    url: `data:image/jpeg;base64,${base64Image}`
                }
            }]
        }];

        return this._makeApiCall(messages);
    }

    async askText(rawText)
    {
        const fullPrompt = this._createTextPrompt(rawText);

        const messages = [
        {
            role: "user",
            content: [
            {
                type: "text",
                text: fullPrompt
            }]
        }];

        return this._makeApiCall(messages);
    }
}

// ============================================================================
// 4. THE FACTORY (The "Switchboard")
//    This is the ONLY function background.js calls. It decides which class
//    to give back based on the model name.
// ============================================================================
export function getAIService(apiKey, modelName, interactionMode, customPrompt)
{
    // ---------------------------------------------------------
    // FUTURE SCALING:
    // If you add Gemini later, you just add this:
    //
    // if (modelName.toLowerCase().includes("gemini"))
    // {
    //     return new GeminiService(apiKey, modelName, interactionMode, customPrompt);
    // }
    // ---------------------------------------------------------

    // Default: Return Groq Service
    return new GroqService(apiKey, modelName, interactionMode, customPrompt);
}