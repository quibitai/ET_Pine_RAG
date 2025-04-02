import { NextResponse } from 'next/server';
import { processFileForRag } from '@/lib/rag-processor';
import { Receiver } from "@upstash/qstash";
import { getDocumentById } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

// Add health check endpoint for diagnostics
export async function GET(request: Request) {
  console.log("[RAG Worker] Health check invoked");
  
  // Basic connectivity diagnostic test
  let connectivityResults = {
    google: { success: false, status: null as number | null, error: null as string | null }
  };
  
  try {
    console.log('[RAG Worker] Testing connectivity to google.com...');
    const googleTest = await fetch('https://google.com', { 
      method: 'HEAD', 
      signal: AbortSignal.timeout(5000)
    });
    connectivityResults.google = { 
      success: true, 
      status: googleTest.status,
      error: null
    };
  } catch (error) {
    connectivityResults.google.error = error instanceof Error ? error.message : String(error);
    console.error('[RAG Worker] Google connectivity test failed:', error);
  }
  
  // Return environment and connectivity information
  return NextResponse.json({
    status: "ok",
    message: "RAG worker is operational",
    timestamp: new Date().toISOString(),
    environment: {
      runtime: process.env.NODE_ENV || "unknown",
      vercel_env: process.env.VERCEL_ENV || "not Vercel",
      region: process.env.VERCEL_REGION || "unknown"
    },
    connectivity: connectivityResults,
    memory: process.memoryUsage ? {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB",
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
    } : "unavailable"
  });
}

// Add test endpoint to diagnose if the worker can handle requests without QStash
// Use a special header for security since we're bypassing signature verification
export async function PATCH(request: Request) {
  console.log("[RAG Worker] Test endpoint invoked (PATCH method)");
  
  // Check for diagnostic test header to ensure this isn't called accidentally
  if (request.headers.get('x-diagnostic-test') !== 'rag-worker-test-123') {
    return NextResponse.json({ error: "Unauthorized test access" }, { status: 401 });
  }
  
  try {
    // Parse the body as we would in the main handler
    const body = await request.json();
    console.log("[RAG Worker] Diagnostic test body:", body);
    
    // Don't actually process anything, just check if we can read the body
    return NextResponse.json({
      status: "test_ok",
      message: "RAG worker direct POST test succeeded",
      receivedBody: body,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[RAG Worker] Diagnostic test error:", error);
    return NextResponse.json({
      status: "test_error",
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// Direct POST handler with manual QStash signature verification
export async function POST(request: Request): Promise<NextResponse> {
    const startTime = new Date();
    console.log(`[RAG Worker] ============ HANDLER INVOKED ============`);
    console.log(`[RAG Worker] Handler started at ${startTime.toISOString()}`);
    console.log(`[RAG Worker] Environment: ${process.env.NODE_ENV || 'unknown'}, Vercel: ${process.env.VERCEL_ENV || 'not Vercel'}`);

    try {
        // STEP 1: Read the raw request body as text ONLY ONCE
        let rawBody: string;
        try {
            console.log('[RAG Worker] Reading raw request body as text...');
            rawBody = await request.text();
            console.log(`[RAG Worker] Successfully read raw body (${rawBody.length} bytes)`);
        } catch (readError) {
            console.error('[RAG Worker] Failed to read request body:', readError);
            return NextResponse.json(
                { error: 'Failed to read request body', details: readError instanceof Error ? readError.message : String(readError) },
                { status: 500 }
            );
        }

        // STEP 2: Get QStash signature from headers
        const signature = request.headers.get('upstash-signature');
        if (!signature) {
            console.error('[RAG Worker] Missing upstash-signature header');
            return NextResponse.json({ error: 'Missing signature header' }, { status: 401 });
        }
        console.log('[RAG Worker] Found upstash-signature header');

        // STEP 3: Initialize Receiver with signing keys from environment variables
        const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
        const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
        
        if (!currentSigningKey || !nextSigningKey) {
            console.error('[RAG Worker] Missing QStash signing keys in environment variables');
            return NextResponse.json({ error: 'Server configuration error: Missing signing keys' }, { status: 500 });
        }

        const receiver = new Receiver({
            currentSigningKey,
            nextSigningKey,
        });

        // STEP 4: Verify signature with the raw body
        let isValid = false;
        try {
            console.log('[RAG Worker] Verifying QStash signature...');
            isValid = await receiver.verify({
                signature,
                body: rawBody,
                // Using a 90s clock tolerance (1.5 minutes) to handle time differences
                clockTolerance: 90
            });
            console.log(`[RAG Worker] Signature verification result: ${isValid ? 'Valid' : 'Invalid'}`);
        } catch (verifyError) {
            console.error('[RAG Worker] Error verifying signature:', verifyError);
            return NextResponse.json(
                { error: 'Signature verification error', details: verifyError instanceof Error ? verifyError.message : String(verifyError) },
                { status: 500 }
            );
        }

        // STEP 5: If verification failed, return error
        if (!isValid) {
            console.error('[RAG Worker] Invalid signature');
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        // STEP 6: Parse the saved raw body text into JSON
        let body;
        try {
            console.log('[RAG Worker] Parsing verified raw body as JSON...');
            body = JSON.parse(rawBody);
            console.log('[RAG Worker] Successfully parsed body:', body);
        } catch (parseError) {
            console.error('[RAG Worker] Failed to parse raw body as JSON:', parseError);
            return NextResponse.json(
                { error: 'Invalid JSON in request body', details: parseError instanceof Error ? parseError.message : String(parseError) },
                { status: 400 }
            );
        }

        // STEP 7: Extract and validate required fields
        const { documentId, userId } = body;
        
        if (!documentId) {
            console.error('[RAG Worker] Missing documentId in payload');
            return NextResponse.json({ error: 'Missing required field: documentId' }, { status: 400 });
        }
        
        if (!userId) {
            console.error('[RAG Worker] Missing userId in payload');
            return NextResponse.json({ error: 'Missing required field: userId' }, { status: 400 });
        }

        // STEP 8: Idempotency check - Verify document exists and check processing status
        try {
            console.log(`[RAG Worker] Checking document ${documentId} in database (idempotency check)...`);
            const document = await getDocumentById({ id: documentId });
            
            if (!document) {
                console.error(`[RAG Worker] Document ${documentId} not found in database`);
                return NextResponse.json({ error: `Document ${documentId} not found` }, { status: 404 });
            }
            
            console.log(`[RAG Worker] Document check successful: ${document.fileName} (${document.fileType}), Status: ${document.processingStatus}`);
            
            // If document is not in 'pending' state, assume this is a retry/duplicate request
            if (document.processingStatus && document.processingStatus !== 'pending') {
                console.log(`[RAG Worker] IDEMPOTENCY CHECK: Document ${documentId} is already in '${document.processingStatus}' state.`);
                return NextResponse.json({
                    message: `Document already in '${document.processingStatus}' state. Request ignored for idempotency.`,
                    status: document.processingStatus,
                    documentId
                }, { status: 200 });
            }
        } catch (dbError) {
            // Log error but continue processing - we'll attempt processing even if the check fails
            console.error(`[RAG Worker] Database error during idempotency check:`, dbError);
        }

        // STEP 9: Process the file
        console.log(`[RAG Worker] Starting RAG processing for document ${documentId} (user: ${userId})...`);
        console.time(`rag_processing_${documentId}`);
        
        try {
            const success = await processFileForRag({ documentId, userId });
            console.timeEnd(`rag_processing_${documentId}`);
            
            if (success) {
                const processingTime = new Date().getTime() - startTime.getTime();
                console.log(`[RAG Worker] Successfully processed document ${documentId} in ${processingTime}ms`);
                return NextResponse.json({
                    message: 'Processing completed successfully',
                    processingTimeMs: processingTime,
                    documentId
                }, { status: 200 });
            } else {
                console.error(`[RAG Worker] Processing returned false for document ${documentId}`);
                return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
            }
        } catch (processingError) {
            console.timeEnd(`rag_processing_${documentId}`);
            console.error(`[RAG Worker] Error during document processing:`, processingError);
            return NextResponse.json({
                error: 'Processing error',
                details: processingError instanceof Error ? processingError.message : String(processingError)
            }, { status: 500 });
        }

    } catch (error) {
        console.error('[RAG Worker] Unhandled error in handler:', error);
        if (error instanceof Error) {
            console.error('[RAG Worker] Error name:', error.name);
            console.error('[RAG Worker] Error message:', error.message);
            console.error('[RAG Worker] Error stack:', error.stack);
        }
        
        return NextResponse.json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    } finally {
        const endTime = new Date();
        const duration = endTime.getTime() - startTime.getTime();
        console.log(`[RAG Worker] Handler completed at ${endTime.toISOString()}`);
        console.log(`[RAG Worker] Total handler duration: ${duration}ms`);
        console.log(`[RAG Worker] ============ HANDLER COMPLETED ============`);
    }
} 