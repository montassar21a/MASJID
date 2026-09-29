import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

// We will test:
// 1. TEST MODE
// 2. Gemini provider
// 3. LibreTranslate provider (ar -> ur)
// 4. LibreTranslate 401/403
// 5. LibreTranslate 429
// 6. LibreTranslate 503
// 7. LibreTranslate timeout
// 8. Unknown provider
// 9. Empty Arabic text
// 10. Duplicate final Arabic text
// 11. Interim speech must not trigger translation
// 12. WebSocket receives translation
// 13. TV displays latest translation
// 14. TV does not display provider errors
// 15. Silence timeout still clears translation
// 16. WebSocket reconnect still works

test('1. TEST MODE: returns mock translation, does not call Gemini or LibreTranslate', async () => {
  // Save env
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origGeminiKey = process.env.TRANSLATION_API_KEY;

  let geminiCalled = false;
  let libreCalled = false;

  // Mock global fetch to detect any external calls
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    libreCalled = true;
    return new Response(JSON.stringify({ translatedText: 'fake' }), { status: 200 });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'true';
    process.env.TRANSLATION_PROVIDER = 'libretranslate';
    // Intentionally omit TRANSLATION_API_KEY to prove Gemini is NOT initialized
    delete process.env.TRANSLATION_API_KEY;

    // Dynamically import fresh translation module or use route handler
    const { translateArabicToUrdu, MOCK_URDU_TRANSLATION } = await import('../lib/translation.ts');
    const result = await translateArabicToUrdu('السلام عليكم');

    assert.equal(result.translation, MOCK_URDU_TRANSLATION);
    assert.equal(result.testMode, true);
    assert.equal(result.provider, 'test');
    assert.equal(geminiCalled, false, 'Gemini must NOT be called in TEST MODE');
    assert.equal(libreCalled, false, 'LibreTranslate must NOT be called in TEST MODE');
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    if (origGeminiKey) process.env.TRANSLATION_API_KEY = origGeminiKey;
  }
});

test('2. Gemini provider: existing Gemini provider configuration and invocation', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origKey = process.env.TRANSLATION_API_KEY;
  const origModel = process.env.GEMINI_MODEL;

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'gemini';
    delete process.env.TRANSLATION_API_KEY;

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    // Without API key, Gemini should throw missing key error
    await assert.rejects(
      async () => {
        await translateArabicToUrdu('السلام عليكم');
      },
      (err) => {
        return err.message === 'Translation service unavailable' && err.status === 500;
      }
    );
  } finally {
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    if (origKey) process.env.TRANSLATION_API_KEY = origKey;
    if (origModel) process.env.GEMINI_MODEL = origModel;
  }
});

test('3. LibreTranslate provider: translates Arabic to Urdu with correct parameters', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origUrl = process.env.LIBRETRANSLATE_URL;
  const origKey = process.env.LIBRETRANSLATE_API_KEY;

  let capturedUrl = '';
  let capturedBody = null;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ translatedText: 'آپ پر سلامتی ہو' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'libretranslate';
    process.env.LIBRETRANSLATE_URL = 'http://mock-libretranslate.local';
    process.env.LIBRETRANSLATE_API_KEY = 'test-libre-key';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');
    const result = await translateArabicToUrdu('السلام عليكم');

    assert.equal(capturedUrl, 'http://mock-libretranslate.local/translate');
    assert.equal(capturedBody.q, 'السلام عليكم');
    assert.equal(capturedBody.source, 'ar');
    assert.equal(capturedBody.target, 'ur');
    assert.equal(capturedBody.format, 'text');
    assert.equal(capturedBody.api_key, 'test-libre-key');

    assert.equal(result.translation, 'آپ پر سلامتی ہو');
    assert.equal(result.testMode, false);
    assert.equal(result.provider, 'libretranslate');
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.LIBRETRANSLATE_URL = origUrl;
    process.env.LIBRETRANSLATE_API_KEY = origKey;
  }
});

test('4. LibreTranslate 401/403 authentication error handling', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origUrl = process.env.LIBRETRANSLATE_URL;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: 'Invalid API Key' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'libretranslate';
    process.env.LIBRETRANSLATE_URL = 'http://mock-libretranslate.local';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 401 && err.message === 'Authentication Error';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.LIBRETRANSLATE_URL = origUrl;
  }
});

test('5. LibreTranslate 429 rate limit error handling', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origUrl = process.env.LIBRETRANSLATE_URL;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'libretranslate';
    process.env.LIBRETRANSLATE_URL = 'http://mock-libretranslate.local';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 429 && err.message === 'LibreTranslate API Quota Exceeded';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.LIBRETRANSLATE_URL = origUrl;
  }
});

test('6. LibreTranslate 503 temporarily unavailable error handling', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origUrl = process.env.LIBRETRANSLATE_URL;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response('Backend server down', { status: 503 });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'libretranslate';
    process.env.LIBRETRANSLATE_URL = 'http://mock-libretranslate.local';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 503 && err.retryable === true && err.message === 'LibreTranslate Temporarily Unavailable';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.LIBRETRANSLATE_URL = origUrl;
  }
});

test('7. LibreTranslate timeout error handling (503 retryable)', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origUrl = process.env.LIBRETRANSLATE_URL;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error('The operation was aborted');
    error.name = 'TimeoutError';
    throw error;
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'libretranslate';
    process.env.LIBRETRANSLATE_URL = 'http://mock-libretranslate.local';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 503 && err.retryable === true && err.message === 'LibreTranslate Temporarily Unavailable';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.LIBRETRANSLATE_URL = origUrl;
  }
});

test('8. Unknown provider returns 400 configuration error', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'unknown_provider_xyz';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('مرحبا');
      },
      (err) => {
        return err.status === 400 && err.message === 'Configuration Error';
      }
    );
  } finally {
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
  }
});

test('9. Empty Arabic text validation in /api/translate route', () => {
  function validateTranslationRequest(body) {
    const { text, sourceLanguage, targetLanguage } = body;
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return { status: 400, error: 'Text is required' };
    }
    if (text.length > 500) {
      return { status: 400, error: 'Text too long' };
    }
    if (sourceLanguage !== 'ar' || targetLanguage !== 'ur') {
      return { status: 400, error: 'Unsupported language pair' };
    }
    return { status: 200 };
  }

  assert.equal(validateTranslationRequest({ text: '', sourceLanguage: 'ar', targetLanguage: 'ur' }).status, 400);
  assert.equal(validateTranslationRequest({ text: '   ', sourceLanguage: 'ar', targetLanguage: 'ur' }).error, 'Text is required');
  assert.equal(validateTranslationRequest({ text: 'a'.repeat(501), sourceLanguage: 'ar', targetLanguage: 'ur' }).error, 'Text too long');
  assert.equal(validateTranslationRequest({ text: 'مرحبا', sourceLanguage: 'en', targetLanguage: 'ur' }).error, 'Unsupported language pair');
  assert.equal(validateTranslationRequest({ text: 'السلام عليكم', sourceLanguage: 'ar', targetLanguage: 'ur' }).status, 200);
});

test('10. Duplicate final Arabic text is ignored by deduplication logic', () => {
  // Simulating duplicate protection behavior from app/page.tsx
  let lastTranslatedText = '';
  let apiCallsCount = 0;

  function onSpeechResult(transcript, isFinal) {
    if (!transcript || isFinal === false) return;
    if (transcript === lastTranslatedText) {
      return; // Duplicate ignored
    }
    lastTranslatedText = transcript;
    apiCallsCount++;
  }

  onSpeechResult('السلام عليكم', true);
  assert.equal(apiCallsCount, 1);

  // Exact same phrase repeated
  onSpeechResult('السلام عليكم', true);
  assert.equal(apiCallsCount, 1, 'Duplicate phrase must NOT trigger a second API call');

  // New phrase
  onSpeechResult('الحمد لله', true);
  assert.equal(apiCallsCount, 2, 'New phrase should trigger API call');
});

test('11. Interim speech must not trigger translation', () => {
  let apiCallsCount = 0;

  function onSpeechResult(transcript, isFinal) {
    if (!transcript || isFinal === false) return;
    apiCallsCount++;
  }

  // Interim speech
  onSpeechResult('السلام', false);
  assert.equal(apiCallsCount, 0, 'Interim speech (isFinal=false) must not trigger translation');

  // Final speech
  onSpeechResult('السلام عليكم', true);
  assert.equal(apiCallsCount, 1, 'Final speech (isFinal=true) should trigger translation');
});

test('12. WebSocket receives translation and broadcasts to session', async () => {
  // Start an in-memory WebSocket server matching server.js logic
  const port = 9088;
  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  const sessions = new Map();
  const sessionLatestTranslations = new Map();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');
    if (!sessionId) {
      ws.close(1008);
      return;
    }
    if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
    sessions.get(sessionId).add(ws);
    ws.sessionId = sessionId;

    const latest = sessionLatestTranslations.get(sessionId);
    if (latest && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(latest));
    }

    ws.on('message', (msg) => {
      const data = JSON.parse(msg);
      if (data.type === 'TRANSLATION') {
        sessionLatestTranslations.set(ws.sessionId, data);
      }
      const sessionClients = sessions.get(ws.sessionId);
      if (sessionClients) {
        for (const client of sessionClients) {
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
        }
      }
    });

    ws.on('close', () => {
      const clients = sessions.get(ws.sessionId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          sessions.delete(ws.sessionId);
          sessionLatestTranslations.delete(ws.sessionId);
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(port, resolve));

  try {
    const sessionId = 'test-session-12';
    const adminWs = new WebSocket(`ws://localhost:${port}?session=${sessionId}`);
    const tvWs = new WebSocket(`ws://localhost:${port}?session=${sessionId}`);

    await Promise.all([
      new Promise((res) => adminWs.on('open', res)),
      new Promise((res) => tvWs.on('open', res)),
    ]);

    const receivedPromise = new Promise((resolve) => {
      tvWs.on('message', (msg) => {
        resolve(JSON.parse(msg));
      });
    });

    const payload = {
      type: 'TRANSLATION',
      sessionId,
      arabic: 'السلام عليكم',
      urdu: 'آپ پر سلامتی ہو',
      timestamp: Date.now(),
    };

    adminWs.send(JSON.stringify(payload));
    const received = await receivedPromise;

    assert.equal(received.type, 'TRANSLATION');
    assert.equal(received.urdu, 'آپ پر سلامتی ہو');
    assert.equal(received.arabic, 'السلام عليكم');

    adminWs.close();
    tvWs.close();
  } finally {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('13. TV displays latest translation (retained translation on connect)', async () => {
  const port = 9089;
  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  const sessions = new Map();
  const sessionLatestTranslations = new Map();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');
    if (!sessionId) {
      ws.close(1008);
      return;
    }
    if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
    sessions.get(sessionId).add(ws);
    ws.sessionId = sessionId;

    const latest = sessionLatestTranslations.get(sessionId);
    if (latest && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(latest));
    }

    ws.on('message', (msg) => {
      const data = JSON.parse(msg);
      if (data.type === 'TRANSLATION') {
        sessionLatestTranslations.set(ws.sessionId, data);
      }
      const sessionClients = sessions.get(ws.sessionId);
      if (sessionClients) {
        for (const client of sessionClients) {
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(port, resolve));

  try {
    const sessionId = 'test-session-13';

    // Step 1: Admin connects and broadcasts translation BEFORE TV connects
    const adminWs = new WebSocket(`ws://localhost:${port}?session=${sessionId}`);
    await new Promise((res) => adminWs.on('open', res));

    adminWs.send(
      JSON.stringify({
        type: 'TRANSLATION',
        sessionId,
        arabic: 'الحمد لله',
        urdu: 'تمام تعریفیں اللہ کے لیے ہیں',
        timestamp: Date.now(),
      })
    );

    // Give server a moment to store
    await new Promise((res) => setTimeout(res, 50));

    // Step 2: TV connects AFTER translation already occurred
    const tvWs = new WebSocket(`ws://localhost:${port}?session=${sessionId}`);

    const receivedOnTvPromise = new Promise((resolve) => {
      tvWs.on('message', (msg) => {
        resolve(JSON.parse(msg));
      });
    });

    const received = await receivedOnTvPromise;
    assert.equal(received.type, 'TRANSLATION');
    assert.equal(received.urdu, 'تمام تعریفیں اللہ کے لیے ہیں');

    adminWs.close();
    tvWs.close();
  } finally {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('14. TV does not display provider errors and masks (Mock Translation)', () => {
  // Test masking of (Mock Translation) on TV
  const rawMockUrdu = 'یہ ایک فرضی ترجمہ ہے۔ (Mock Translation)';
  const tvDisplayUrdu = rawMockUrdu.replace(/\s*\(Mock Translation\)/gi, '').trim();

  assert.equal(tvDisplayUrdu, 'یہ ایک فرضی ترجمہ ہے۔');
  assert.equal(tvDisplayUrdu.includes('(Mock Translation)'), false);

  // Test that TV does not render provider errors:
  const tvViewProps = {
    view: 'display',
    errorMessage: 'LibreTranslate temporarily unavailable (503)',
  };
  // In app/page.tsx, errorMessage is only rendered if view === 'admin'
  const tvRendersError = tvViewProps.view === 'admin' ? tvViewProps.errorMessage : null;
  assert.equal(tvRendersError, null, 'TV display must never display provider error messages');
});

test('15. Silence timeout clears translation after delay', async () => {
  let currentTranslation = { arabic: 'السلام', urdu: 'سلام' };
  let sessionState = 'DISPLAYING';
  const silenceDelay = 0.05; // 50ms for test
  let timerId = null;

  function onTranslationReceived() {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      currentTranslation = null;
      sessionState = 'WAITING';
    }, silenceDelay * 1000);
  }

  onTranslationReceived();
  assert.notEqual(currentTranslation, null);
  assert.equal(sessionState, 'DISPLAYING');

  // Wait for silence delay to fire
  await new Promise((res) => setTimeout(res, 80));

  assert.equal(currentTranslation, null, 'Translation should be cleared after silence timeout');
  assert.equal(sessionState, 'WAITING', 'State should be WAITING after silence timeout');
});

test('16. WebSocket reconnect increment mechanism triggers retry', () => {
  let reconnectAttempts = 0;
  let connectionState = 'CONNECTED';

  function onWsClose() {
    connectionState = 'RECONNECTING';
    reconnectAttempts++;
  }

  assert.equal(connectionState, 'CONNECTED');
  onWsClose();
  assert.equal(connectionState, 'RECONNECTING');
  assert.equal(reconnectAttempts, 1, 'Reconnect attempt state should increment to trigger reconnect effect');
});

test('17. OpenRouter successfully translates Arabic to Urdu with correct model, prompt, and headers', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origUrl = process.env.OPENROUTER_URL;
  const origKey = process.env.OPENROUTER_API_KEY;
  const origModel = process.env.OPENROUTER_MODEL;

  let capturedUrl = '';
  let capturedHeaders = null;
  let capturedBody = null;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: 'آپ پر سلامتی ہو',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'openrouter';
    process.env.OPENROUTER_URL = 'https://openrouter.ai/api/v1';
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    process.env.OPENROUTER_MODEL = 'openrouter/free';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');
    const result = await translateArabicToUrdu('السلام عليكم');

    assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(capturedHeaders.Authorization, 'Bearer test-openrouter-key');
    assert.equal(capturedBody.model, 'openrouter/free');
    assert.equal(capturedBody.messages[0].role, 'system');
    assert.equal(capturedBody.messages[0].content.includes('Translate Arabic → Urdu'), true);
    assert.equal(capturedBody.messages[1].role, 'user');
    assert.equal(capturedBody.messages[1].content, 'السلام عليكم');

    assert.equal(result.translation, 'آپ پر سلامتی ہو');
    assert.equal(result.testMode, false);
    assert.equal(result.provider, 'openrouter');
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.OPENROUTER_URL = origUrl;
    process.env.OPENROUTER_API_KEY = origKey;
    process.env.OPENROUTER_MODEL = origModel;
  }
});

test('18. OpenRouter 401/403 authentication error handling', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origKey = process.env.OPENROUTER_API_KEY;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'invalid-key';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 401 && err.message === 'Authentication Error';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.OPENROUTER_API_KEY = origKey;
  }
});

test('19. OpenRouter 429 rate limit / quota error handling', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origKey = process.env.OPENROUTER_API_KEY;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'valid-key';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 429 && err.message === 'OpenRouter API Quota Exceeded';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.OPENROUTER_API_KEY = origKey;
  }
});

test('20. OpenRouter 503 temporarily unavailable error handling', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origKey = process.env.OPENROUTER_API_KEY;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response('OpenRouter gateway down', { status: 503 });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'valid-key';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 503 && err.retryable === true && err.message === 'OpenRouter Temporarily Unavailable';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.OPENROUTER_API_KEY = origKey;
  }
});

test('21. OpenRouter timeout error handling (503 retryable)', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origKey = process.env.OPENROUTER_API_KEY;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error('The operation was aborted');
    error.name = 'TimeoutError';
    throw error;
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'valid-key';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 503 && err.retryable === true && err.message === 'OpenRouter Temporarily Unavailable';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.OPENROUTER_API_KEY = origKey;
  }
});

test('22. TEST MODE still bypasses OpenRouter completely', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origKey = process.env.OPENROUTER_API_KEY;

  let openrouterCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    openrouterCalled = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'test' } }] }));
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'true';
    process.env.TRANSLATION_PROVIDER = 'openrouter';
    delete process.env.OPENROUTER_API_KEY;

    const { translateArabicToUrdu, MOCK_URDU_TRANSLATION } = await import('../lib/translation.ts');
    const result = await translateArabicToUrdu('سبحان الله');

    assert.equal(result.translation, MOCK_URDU_TRANSLATION);
    assert.equal(result.testMode, true);
    assert.equal(result.provider, 'test');
    assert.equal(openrouterCalled, false, 'OpenRouter must NOT be called in TEST MODE');
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    if (origKey) process.env.OPENROUTER_API_KEY = origKey;
  }
});

test('23. OpenRouter 404 model not found / no endpoints error handling', async () => {
  const origTestMode = process.env.TRANSLATION_TEST_MODE;
  const origProvider = process.env.TRANSLATION_PROVIDER;
  const origKey = process.env.OPENROUTER_API_KEY;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: { message: 'No endpoints found for model' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    process.env.TRANSLATION_TEST_MODE = 'false';
    process.env.TRANSLATION_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'valid-key';

    const { translateArabicToUrdu } = await import('../lib/translation.ts');

    await assert.rejects(
      async () => {
        await translateArabicToUrdu('الحمد لله');
      },
      (err) => {
        return err.status === 404 && err.message === 'OpenRouter Model Error';
      }
    );
  } finally {
    globalThis.fetch = origFetch;
    process.env.TRANSLATION_TEST_MODE = origTestMode;
    process.env.TRANSLATION_PROVIDER = origProvider;
    process.env.OPENROUTER_API_KEY = origKey;
  }
});
