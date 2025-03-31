import { NextResponse } from 'next/server';
import { processFileForRag } from '@/lib/rag-processor';
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs"; // Use the App Router wrapper

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

// Define the main handler logic separately
async function handler(request: Request) {
  // Add startup confirmation log
  console.log(`[RAG Worker] Handler invoked at ${new Date().toISOString()}`);
  console.log('[RAG Worker] Signature already verified by wrapper.');

  // Log request details (optional, as verification is done)
  console.log('[RAG Worker] Request headers:', Object.fromEntries(request.headers.entries()));
  console.log('[RAG Worker] Request method:', request.method);
  console.log('[RAG Worker] Request URL:', request.url);

  try {
    // Parse the job payload (body has already been read by the wrapper/Next.js)
    const body = await request.json();
    console.log('[RAG Worker] Parsed request body:', body);

    const { documentId, userId } = body;

    if (!documentId || !userId) {
      console.error('[RAG Worker] Invalid job payload:', body);
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    console.log(`[RAG Worker] Processing document ${documentId} for user ${userId}`);
    const success = await processFileForRag({ documentId, userId });

    if (success) {
      console.log(`[RAG Worker] Successfully processed document ${documentId}`);
      return NextResponse.json(
        { message: 'Processing completed successfully' },
        { status: 200 }
      );
    } else {
      console.error(`[RAG Worker] Processing failed for document ${documentId}`);
      return NextResponse.json(
        { error: 'Processing failed' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('[RAG Worker] Unhandled error in handler:', error);
    if (error instanceof Error) {
      console.error('[RAG Worker] Error name:', error.name);
      console.error('[RAG Worker] Error message:', error.message);
      console.error('[RAG Worker] Error stack:', error.stack);
    }
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// Export the POST handler wrapped by verifySignatureAppRouter
// This automatically loads QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY from env
export const POST = verifySignatureAppRouter(handler); 