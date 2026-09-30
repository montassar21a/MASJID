import { GoogleGenAI } from '@google/genai';
import type { TranslateMode } from './types';

export type TranslationProvider = 'gemini' | 'libretranslate' | 'openrouter' | 'test';

export interface TranslationResult {
  translation: string;
  testMode: boolean;
  provider: TranslationProvider;
}

export class TranslationError extends Error {
  status: number;
  details?: string;
  retryable: boolean;

  constructor(
    message: string,
    status: number = 500,
    details?: string,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'TranslationError';
    this.status = status;
    this.details = details;
    this.retryable = retryable;
  }
}

const SYSTEM_PROMPT = `You are a real-time Arabic to Urdu translator for a mosque TV display.
Translate the following Arabic speech to Urdu.
Requirements:
- Natural Urdu
- Preserve religious terminology accurately (e.g. Allah, Alhamdulillah, Jannah)
- Keep sentence meaning intact
- No explanation
- No quotation marks
- No additional commentary
- Do not return Arabic unless specifically requested
- Do not invent information

Translate exactly what is provided.`;

const OPENROUTER_SYSTEM_PROMPT = `Translate Arabic → Urdu.
Preserve the meaning accurately.
Do not explain the translation.
Return ONLY the Urdu translation.
Preserve Islamic/Mosque terminology appropriately.
Do not add commentary, greetings, or extra text.`;

const OPENROUTER_INTERIM_SYSTEM_PROMPT = `Translate the provided Arabic speech fragment into Urdu in real time.
Requirements:
- Translate ONLY the words provided.
- Do NOT attempt to complete the unfinished sentence.
- Do NOT add polite greetings, punctuation, or commentary.
- Return ONLY the raw Urdu fragment.`;

export const MOCK_URDU_TRANSLATION = 'یہ ایک فرضی ترجمہ ہے۔ (Mock Translation)';

/**
 * Translates Arabic text to Urdu based on configured TRANSLATION_PROVIDER and TRANSLATION_TEST_MODE.
 * TEST MODE always overrides Gemini, LibreTranslate, and OpenRouter without calling external APIs.
 */
export async function translateArabicToUrdu(
  text: string,
  mode: TranslateMode = 'final'
): Promise<TranslationResult> {
  // TEST MODE: Must ALWAYS override all providers without calling external APIs
  if (process.env.TRANSLATION_TEST_MODE === 'true') {
    console.log('[TRANSLATION] provider=test');
    console.log('[TRANSLATION] mock translation');
    // Simulate slight processing delay for natural feel
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      translation: MOCK_URDU_TRANSLATION,
      testMode: true,
      provider: 'test',
    };
  }

  const rawProvider = process.env.TRANSLATION_PROVIDER || 'gemini';
  const provider = rawProvider.trim().toLowerCase();

  if (provider === 'gemini') {
    return translateWithGemini(text);
  }

  if (provider === 'libretranslate') {
    return translateWithLibreTranslate(text);
  }

  if (provider === 'openrouter') {
    return translateWithOpenRouter(text, mode);
  }

  throw new TranslationError('Configuration Error', 400, `Unsupported provider: ${rawProvider}`);
}

/**
 * Gemini translation provider using @google/genai and GEMINI_MODEL.
 */
async function translateWithGemini(text: string): Promise<TranslationResult> {
  const apiKey = process.env.TRANSLATION_API_KEY;
  if (!apiKey) {
    console.error('TRANSLATION_API_KEY is missing');
    throw new TranslationError('Translation service unavailable', 500, 'API key is missing');
  }

  const modelName = process.env.GEMINI_MODEL;
  if (!modelName) {
    throw new TranslationError('Configuration Error', 500, 'GEMINI_MODEL is not configured');
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: modelName,
      contents: text,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
      },
    });

    if (!response.text) {
      throw new Error(`Gemini API error: Empty response returned from model ${modelName}`);
    }

    const cleanedText = response.text.trim().replace(/^["']|["']$/g, '');
    console.log('[TRANSLATION] provider=gemini');
    console.log('[TRANSLATION] success');

    return {
      translation: cleanedText,
      testMode: false,
      provider: 'gemini',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('503') || errorMessage.includes('UNAVAILABLE')) {
      console.warn('Gemini temporarily unavailable (503)');
      throw new TranslationError(
        'Gemini Temporarily Unavailable',
        503,
        'Gemini is temporarily unavailable because the model is experiencing high demand.',
        true
      );
    }

    if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      console.warn('Gemini quota exceeded (429)');
      throw new TranslationError(
        'Gemini API Quota Exceeded',
        429,
        'The quota for this specific model or project has been exceeded. Please check your billing or rate limits.'
      );
    }

    if (
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      errorMessage.includes('PERMISSION_DENIED')
    ) {
      console.warn('Gemini authentication error (401/403)');
      throw new TranslationError(
        'Authentication Error',
        401,
        'Invalid API key or insufficient permissions.'
      );
    }

    if (errorMessage.includes('404') || errorMessage.includes('NOT_FOUND')) {
      console.warn('Gemini model not found (404)');
      throw new TranslationError(
        'Model Not Found',
        404,
        'The requested Gemini model is not found or not supported.'
      );
    }

    if (errorMessage === 'GEMINI_MODEL is not configured') {
      throw new TranslationError('Configuration Error', 500, errorMessage);
    }

    console.error('Translation error:', error);
    throw new TranslationError('Translation failed internally', 500, errorMessage);
  }
}

/**
 * LibreTranslate provider using server-side HTTP request to LIBRETRANSLATE_URL.
 */
async function translateWithLibreTranslate(text: string): Promise<TranslationResult> {
  const baseUrl = process.env.LIBRETRANSLATE_URL;
  if (!baseUrl || baseUrl.trim() === '') {
    throw new TranslationError('Configuration Error', 500, 'LIBRETRANSLATE_URL is not configured');
  }

  let endpoint = baseUrl.trim();
  if (!endpoint.endsWith('/translate')) {
    endpoint = endpoint.replace(/\/+$/, '') + '/translate';
  }

  const apiKey = process.env.LIBRETRANSLATE_API_KEY;

  const requestBody: Record<string, string> = {
    q: text,
    source: 'ar',
    target: 'ur',
    format: 'text',
  };

  if (apiKey && apiKey.trim() !== '') {
    requestBody.api_key = apiKey.trim();
  }

  console.log('[TRANSLATION] provider=libretranslate');
  console.log('[TRANSLATION] source=ar target=ur');

  let response: Response;
  const timeoutMs = 8000;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.warn('[TRANSLATION] LibreTranslate connection timeout');
      throw new TranslationError(
        'LibreTranslate Temporarily Unavailable',
        503,
        'LibreTranslate connection timeout.',
        true
      );
    }

    console.warn('[TRANSLATION] LibreTranslate unavailable (network error)');
    throw new TranslationError(
      'LibreTranslate Temporarily Unavailable',
      503,
      `LibreTranslate network error: ${error?.message || 'Failed to connect'}`,
      true
    );
  }

  if (!response.ok) {
    const status = response.status;
    let details = '';
    try {
      const errJson = await response.json();
      details = errJson.error || errJson.message || '';
    } catch {
      // Ignore JSON parse error on error response
    }

    if (status === 400) {
      console.warn('[TRANSLATION] LibreTranslate bad request (400)');
      throw new TranslationError(
        'Bad Translation Request',
        400,
        details || 'LibreTranslate rejected the request parameters.'
      );
    }

    if (status === 401 || status === 403) {
      console.warn(`[TRANSLATION] LibreTranslate authentication error (${status})`);
      throw new TranslationError(
        'Authentication Error',
        401,
        details || 'Invalid LibreTranslate API key or unauthorized access.'
      );
    }

    if (status === 429) {
      console.warn('[TRANSLATION] LibreTranslate rate limit/quota exceeded (429)');
      throw new TranslationError(
        'LibreTranslate API Quota Exceeded',
        429,
        details || 'The quota or rate limit for LibreTranslate has been exceeded.'
      );
    }

    if (status === 502 || status === 503 || status === 504) {
      console.warn(`[TRANSLATION] LibreTranslate temporarily unavailable (${status})`);
      throw new TranslationError(
        'LibreTranslate Temporarily Unavailable',
        503,
        details || 'LibreTranslate is temporarily unavailable.',
        true
      );
    }

    if (status === 500) {
      console.warn('[TRANSLATION] LibreTranslate server error (500)');
      throw new TranslationError(
        'LibreTranslate Server Error',
        500,
        details || 'LibreTranslate encountered an internal server error.'
      );
    }

    console.warn(`[TRANSLATION] LibreTranslate error (${status})`);
    throw new TranslationError(
      'Translation failed internally',
      status >= 400 && status < 600 ? status : 500,
      details || `LibreTranslate error: HTTP ${status}`
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch (error) {
    console.error('Failed to parse LibreTranslate response as JSON', error);
    throw new TranslationError('Translation failed internally', 500, 'Invalid JSON returned by LibreTranslate');
  }

  if (!data || typeof data.translatedText !== 'string' || !data.translatedText.trim()) {
    throw new TranslationError('Translation failed internally', 500, 'Empty response returned from LibreTranslate');
  }

  const cleanedText = data.translatedText.trim().replace(/^["']|["']$/g, '');
  console.log('[TRANSLATION] success');

  return {
    translation: cleanedText,
    testMode: false,
    provider: 'libretranslate',
  };
}

/**
 * OpenRouter translation provider using OpenAI-compatible Chat Completions API.
 * Uses OPENROUTER_URL, OPENROUTER_MODEL, and OPENROUTER_API_KEY.
 */
export async function translateWithOpenRouter(
  text: string,
  mode: TranslateMode = 'final'
): Promise<TranslationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error('OPENROUTER_API_KEY is missing');
    throw new TranslationError('Translation service unavailable', 500, 'OPENROUTER_API_KEY is missing');
  }

  const baseUrl = (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').trim();
  let endpoint = baseUrl;
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
  }

  const model = (process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash').trim();

  const isInterim = mode === 'interim';
  const systemPrompt = isInterim ? OPENROUTER_INTERIM_SYSTEM_PROMPT : OPENROUTER_SYSTEM_PROMPT;
  const maxTokens = isInterim ? 60 : 150;
  const temperature = isInterim ? 0.1 : 0.2;

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  console.log('[TRANSLATION] provider=openrouter');
  console.log('[TRANSLATION] source=ar target=ur');

  let response: Response;
  const timeoutMs = 10000;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://noorlive.local',
        'X-Title': 'Noor Live',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.warn('[TRANSLATION] OpenRouter connection timeout');
      throw new TranslationError(
        'OpenRouter Temporarily Unavailable',
        503,
        'OpenRouter connection timeout.',
        true
      );
    }

    console.warn('[TRANSLATION] OpenRouter unavailable (network error)');
    throw new TranslationError(
      'OpenRouter Temporarily Unavailable',
      503,
      `OpenRouter network error: ${error?.message || 'Failed to connect'}`,
      true
    );
  }

  if (!response.ok) {
    const status = response.status;
    let details = '';
    try {
      const errJson = await response.json();
      details = errJson.error?.message || errJson.error || errJson.message || '';
    } catch {
      // Ignore JSON parse error on error response
    }

    if (status === 401 || status === 403) {
      console.warn(`[TRANSLATION] OpenRouter authentication error (${status})`);
      throw new TranslationError(
        'Authentication Error',
        401,
        details || 'Invalid OpenRouter API key or unauthorized access.'
      );
    }

    if (status === 404) {
      console.warn(`[TRANSLATION] OpenRouter model not found (404)`);
      throw new TranslationError(
        'OpenRouter Model Error',
        404,
        details || `The model "${model}" was not found or has no available endpoints on OpenRouter.`
      );
    }

    if (status === 429) {
      console.warn('[TRANSLATION] OpenRouter rate limit/quota exceeded (429)');
      throw new TranslationError(
        'OpenRouter API Quota Exceeded',
        429,
        details || 'Rate limit or quota exceeded for OpenRouter.'
      );
    }

    if (status === 500 || status === 502 || status === 503 || status === 504) {
      console.warn(`[TRANSLATION] OpenRouter temporarily unavailable (${status})`);
      throw new TranslationError(
        'OpenRouter Temporarily Unavailable',
        503,
        details || 'OpenRouter is temporarily unavailable.',
        true
      );
    }

    console.warn(`[TRANSLATION] OpenRouter error (${status})`);
    throw new TranslationError(
      'Translation failed internally',
      status >= 400 && status < 600 ? status : 500,
      details || `OpenRouter error: HTTP ${status}`
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch (error) {
    console.error('Failed to parse OpenRouter response as JSON', error);
    throw new TranslationError('Translation failed internally', 500, 'Invalid JSON returned by OpenRouter');
  }

  const translatedContent = data?.choices?.[0]?.message?.content;
  if (!translatedContent || typeof translatedContent !== 'string' || !translatedContent.trim()) {
    throw new TranslationError('Translation failed internally', 500, 'Empty response returned from OpenRouter');
  }

  const cleanedText = translatedContent.trim().replace(/^["']|["']$/g, '');
  console.log('[TRANSLATION] success');

  return {
    translation: cleanedText,
    testMode: false,
    provider: 'openrouter',
  };
}
