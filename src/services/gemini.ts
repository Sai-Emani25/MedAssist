import { GoogleGenAI, GenerateContentResponse, ThinkingLevel } from "@google/genai";

export enum GeminiErrorType {
  NETWORK = 'NETWORK',
  API = 'API',
  PROMPT = 'PROMPT',
  UNKNOWN = 'UNKNOWN'
}

export class GeminiError extends Error {
  constructor(public type: GeminiErrorType, message: string, public originalError?: any) {
    super(message);
    this.name = 'GeminiError';
  }
}

const SYSTEM_INSTRUCTION = `You are an empathetic medical assistant named MedAssist. Your goal is to help users understand their symptoms and provide clear, structured health insights.

RESPONSE STRUCTURE:
1. **Quick Summary**: A brief, empathetic acknowledgment of the user's situation.
2. **Possible Considerations**: 2-3 common conditions or factors that *could* be related to the symptoms. Use simple language.
3. **What to Watch For**: Specific "red flag" symptoms that would require more urgent attention.
4. **Suggested Next Steps**: Practical advice (e.g., "Keep a symptom diary", "Schedule a non-urgent GP visit", "Rest and hydrate").
5. **Medical Disclaimer**: A standard closing disclaimer.

CRITICAL GUARDRAILS:
1. **NO DIAGNOSIS**: Never say "You have X". Use "Your symptoms are often seen in..." or "This might be related to...".
2. **NO PRESCRIPTIONS**: Never suggest specific drugs or dosages.
3. **EMERGENCY FIRST**: If symptoms suggest a life-threatening emergency (chest pain, stroke signs, severe difficulty breathing, heavy bleeding), lead with a bold instruction to CALL EMERGENCY SERVICES (911) immediately and provide no other analysis.
4. **EMPATHY**: Maintain a warm, supportive, and professional tone.
5. **CLARITY**: Use plain English. If you must use a medical term, explain it simply in parentheses.
6. **CONCISE**: Use bullet points and short paragraphs. Avoid long blocks of text. Keep the total response under 400 words.

If medical records are provided, integrate them into your reasoning (e.g., "Given your recent blood test showing low iron, this fatigue might be related to..."). If asked about medication changes, always advise consulting their prescribing doctor first.`;

export async function analyzeSymptoms(
  messages: { role: 'user' | 'model', parts: any[] }[],
  medicalHistory?: string
) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const model = "gemini-3.1-pro-preview";

    // Add medical history as context if it's the first message
    const contents = [...messages];
    if (medicalHistory && contents.length > 0 && contents[0].role === 'user') {
      contents[0].parts.unshift({ text: `User Medical History/Records for context: ${medicalHistory}\n\n` });
    }

    const response: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7,
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
      },
    });

    if (!response.text) {
      throw new GeminiError(GeminiErrorType.API, "The AI returned an empty response.");
    }

    return response.text;
  } catch (err: any) {
    console.error("Gemini API Error:", err);
    
    if (err instanceof GeminiError) throw err;

    const message = err.message || String(err);
    
    if (message.includes('fetch') || message.includes('network') || message.includes('Load failed')) {
      throw new GeminiError(GeminiErrorType.NETWORK, "Connection lost. Please check your internet and try again.", err);
    }
    
    if (message.includes('safety') || message.includes('blocked') || message.includes('candidate')) {
      throw new GeminiError(GeminiErrorType.PROMPT, "I'm sorry, but I can't process that request due to safety guidelines. Please try rephrasing.", err);
    }

    if (message.includes('API key') || message.includes('403') || message.includes('401')) {
      throw new GeminiError(GeminiErrorType.API, "There's an issue with the AI service configuration. Please contact support.", err);
    }

    if (message.includes('quota') || message.includes('429') || message.includes('limit')) {
      throw new GeminiError(GeminiErrorType.API, "The AI service is currently busy (quota exceeded). Please wait a moment and try again.", err);
    }

    throw new GeminiError(GeminiErrorType.UNKNOWN, "An unexpected error occurred while analyzing symptoms.", err);
  }
}

const RECORD_ANALYSIS_INSTRUCTION = `You are a medical data analyst. Your task is to analyze medical records (blood tests, diagnoses, reports) and provide a clear, structured summary for the user.

RESPONSE STRUCTURE:
1. **Key Findings**: Highlight the most important values or findings from the record.
2. **What This Means**: Explain in simple terms what these findings indicate.
3. **Questions for Your Doctor**: Provide 2-3 specific questions the user should ask their physician based on this record.
4. **Disclaimer**: Remind the user that this is an AI analysis and not a professional medical interpretation.

CRITICAL GUARDRAILS:
- Do not diagnose. Use phrases like "These results suggest..." or "This is often associated with...".
- Be objective and clear.
- If the record is unclear or incomplete, state that clearly.
- Keep the analysis under 300 words.`;

export async function analyzeMedicalRecord(
  recordType: string,
  content: string,
  originalDiagnosis?: string,
  medication?: string,
  file?: { data: string, mimeType: string }
) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const model = "gemini-3.1-pro-preview";

    const prompt = `
      Record Type: ${recordType}
      User Summary/Notes: ${content || 'No notes provided'}
      Original Diagnosis: ${originalDiagnosis || 'Not specified'}
      Current Medication: ${medication || 'Not specified'}
      
      Please analyze this medical record and provide a structured summary.
    `;

    const parts: any[] = [{ text: prompt }];
    if (file) {
      parts.push({
        inlineData: {
          data: file.data,
          mimeType: file.mimeType
        }
      });
    }

    const response: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: RECORD_ANALYSIS_INSTRUCTION,
        temperature: 0.4,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
      },
    });

    if (!response.text) {
      throw new GeminiError(GeminiErrorType.API, "The AI returned an empty response.");
    }

    return response.text;
  } catch (err: any) {
    console.error("Gemini Record Analysis Error:", err);
    
    if (err instanceof GeminiError) throw err;

    const message = err.message || String(err);
    
    if (message.includes('fetch') || message.includes('network') || message.includes('Load failed')) {
      throw new GeminiError(GeminiErrorType.NETWORK, "Connection lost. Please check your internet and try again.", err);
    }
    
    if (message.includes('safety') || message.includes('blocked') || message.includes('candidate')) {
      throw new GeminiError(GeminiErrorType.PROMPT, "I'm sorry, but I can't analyze this record due to safety guidelines.", err);
    }

    if (message.includes('API key') || message.includes('403') || message.includes('401')) {
      throw new GeminiError(GeminiErrorType.API, "There's an issue with the AI service configuration.", err);
    }

    if (message.includes('quota') || message.includes('429') || message.includes('limit')) {
      throw new GeminiError(GeminiErrorType.API, "The AI service is currently busy. Please try again in a moment.", err);
    }

    throw new GeminiError(GeminiErrorType.UNKNOWN, "An unexpected error occurred while analyzing the medical record.", err);
  }
}

const RECORD_CHAT_INSTRUCTION = `You are a medical data analyst. You are helping a user understand a specific medical record.
The user will provide the record details and may ask follow-up questions.

CRITICAL GUARDRAILS:
1. **NO DIAGNOSIS**: Never say "You have X". Use "Your symptoms are often seen in..." or "This might be related to...".
2. **NO PRESCRIPTIONS**: Never suggest specific drugs or dosages.
3. **EMERGENCY FIRST**: If symptoms suggest a life-threatening emergency, lead with a bold instruction to CALL EMERGENCY SERVICES (911) immediately.
4. **EMPATHY**: Maintain a warm, supportive, and professional tone.
5. **CLARITY**: Use plain English.
6. **CONCISE**: Keep responses focused on the specific record provided.

If asked about medication changes, always advise consulting their prescribing doctor first.`;

export async function chatAboutRecord(
  record: {
    recordType: string;
    timestamp: string;
    content?: string;
    originalDiagnosis?: string;
    medication?: string;
    analysis?: string;
  },
  messages: { role: 'user' | 'model', content: string }[]
) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const model = "gemini-3.1-pro-preview";

    const recordContext = `
      RECORD CONTEXT:
      Type: ${record.recordType}
      Date: ${record.timestamp}
      Summary: ${record.content || 'N/A'}
      Diagnosis: ${record.originalDiagnosis || 'N/A'}
      Medication: ${record.medication || 'N/A'}
      Initial AI Analysis: ${record.analysis || 'N/A'}
    `;

    const contents = messages.map(m => ({
      role: m.role,
      parts: [{ text: m.content }]
    }));

    // Inject context into the first user message
    if (contents.length > 0 && contents[0].role === 'user') {
      contents[0].parts.unshift({ text: recordContext + "\n\n" });
    }

    const response: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: RECORD_CHAT_INSTRUCTION,
        temperature: 0.7,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
      },
    });

    if (!response.text) {
      throw new GeminiError(GeminiErrorType.API, "The AI returned an empty response.");
    }

    return response.text;
  } catch (err: any) {
    console.error("Gemini Record Chat Error:", err);
    if (err instanceof GeminiError) throw err;
    throw new GeminiError(GeminiErrorType.UNKNOWN, "Failed to chat about the record.", err);
  }
}
