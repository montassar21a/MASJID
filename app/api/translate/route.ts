import { NextResponse } from 'next/server';
import { translateArabicToUrdu, TranslationError } from '@/lib/translation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const isTestMode = process.env.TRANSLATION_TEST_MODE === 'true';
  const rawProvider = process.env.TRANSLATION_PROVIDER || 'gemini';
  const provider = isTestMode ? 'test' : rawProvider.trim().toLowerCase();

  return NextResponse.json(
    {
      provider,
      testMode: isTestMode,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, sourceLanguage, targetLanguage } = body;

    if (!text || typeof text !== 'string' || text.trim() === '') {
      return NextResponse.json(
        { error: 'Text is required' },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        }
      );
    }

    if (text.length > 500) {
      return NextResponse.json(
        { error: 'Text too long' },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        }
      );
    }

    if (sourceLanguage !== 'ar' || targetLanguage !== 'ur') {
      return NextResponse.json(
        { error: 'Unsupported language pair' },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        }
      );
    }

    const result = await translateArabicToUrdu(text.trim());
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    if (error instanceof TranslationError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
          ...(error.retryable ? { retryable: true } : {}),
        },
        {
          status: error.status,
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Translation error:', error);
    return NextResponse.json(
      {
        error: 'Translation failed internally',
        details: errorMessage,
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      }
    );
  }
}
