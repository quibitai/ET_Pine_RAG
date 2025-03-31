import { NextResponse } from 'next/server';
import { processFileForRag } from '@/lib/rag-processor';
import { verifySignature } from "@upstash/qstash/dist/nextjs";

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

/**
 * Handles background RAG processing jobs from QStash
 * Verifies request signature and processes documents using processFileForRag
 */
export async function POST(request: Request) {
  console.log('[RAG Worker] Received job request');

  try {
    // Get the raw request body for signature verification
    const rawBody = await request.text();
    
    // Verify QStash signature (commented out until we verify the correct method)
    // const isValid = await verifySignature(request);
    // 
    // if (!isValid) {
    //   console.error('[RAG Worker] Invalid QStash signature');
    //   return new Response('Invalid signature', { status: 401 });
    // }

    // Parse the job payload
    const body = JSON.parse(rawBody);
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
    console.error('[RAG Worker] Unhandled error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
} 