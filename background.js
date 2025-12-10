// background.js - Updated for Llama 4 Scout



const PROMPTS = {
  // Enhanced short prompt for high accuracy (for 'short' mode selection)
  short: "You are a specialized Quiz Solver for the user's current image. Analyze the content, determine the single most accurate answer, and ensure your explanation is directly supported by the image. Output ONLY in this format:\n**Answer:** [Correct Option/Value/Option Letter]\n**Why:** [One short, concise sentence explanation justifying the answer]. DO NOT ADD ANY OTHER TEXT.",
  
  // Your preferred default prompt, structured to match the Markdown parser
  default: "Analyze the image and give me the correct option with short explanation. Output ONLY in this format:\n**Answer:** [Correct Option/Value/Option Letter]\n**Why:** [One short explanation justifying the answer]. make sure the option is correct.",
  
  detailed: "You are a tutor. Analyze the image in detail. Break down the solution step-by-step. If it's code, explain the logic. Use bolding and bullet points.",
  code: "You are a Code Linter. 1. Immediately provide the CORRECTED code block. 2. Underneath, explain exactly what caused the bug (1-2 sentences). Do not waste time with pleasantries.",
  
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CAPTURE_VISIBLE_TAB") {
    chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 80 }, (dataUrl) => {
      sendResponse({ dataUrl: dataUrl });
    });
    return true; 
  }

  if (request.action === "ASK_GROQ") {
    handleGroqRequest(request.apiKey, request.base64Image, sendResponse);
    return true; 
  }
});

async function handleGroqRequest(apiKey, base64Image, sendResponse) {
  try {
    const storage = await chrome.storage.local.get(['interactionMode', 'customPrompt', 'selectedModel']);
    const mode = storage.interactionMode || 'short';
    
    // NEW CORRECT ID DEFAULT
    const modelName = storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

    let finalPrompt = PROMPTS[mode] || PROMPTS['default'];
    if (mode === 'custom' && storage.customPrompt) {
      finalPrompt = storage.customPrompt;
    }

    console.log(`Using Groq Model: ${modelName}`); 

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: finalPrompt },
              { 
                type: "image_url", 
                image_url: { 
                  url: `data:image/jpeg;base64,${base64Image}` 
                } 
              }
            ]
          }
        ],
        model: modelName,
        temperature: 0.1,
        max_tokens: 1024
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      const errorMsg = data.error ? data.error.message : "Network Error";
      throw new Error(errorMsg);
    }
    
    const answer = data.choices[0].message.content;
    sendResponse({ success: true, answer: answer });

  } catch (error) {
    console.error("Groq Error:", error);
    sendResponse({ success: false, error: error.message });
  }
}