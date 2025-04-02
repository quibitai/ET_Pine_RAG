import { NextResponse } from 'next/server';
import { processFileForRag } from '@/lib/rag-processor';
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs"; // Use the App Router wrapper
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

// Define the main handler logic separately
async function handler(request: Request) {
  // Add startup confirmation log with timestamp for tracking in logs
  const startTime = new Date();
  console.log(`[RAG Worker] ============ HANDLER INVOKED ============`);
  console.log(`[RAG Worker] Handler started at ${startTime.toISOString()}`);
  console.log(`[RAG Worker] QStash signature verified by wrapper`);

  // Log environment awareness
  console.log(`[RAG Worker] Running in environment: ${process.env.NODE_ENV || 'unknown'}`);
  console.log(`[RAG Worker] Vercel environment: ${process.env.VERCEL_ENV || 'not Vercel'}`);
  console.log(`[RAG Worker] Vercel region: ${process.env.VERCEL_REGION || 'unknown'}`);

  // Basic connectivity diagnostic test
  try {
    console.log('[RAG Worker] DIAGNOSTIC: Testing basic outbound connectivity to google.com...');
    // Use HEAD request for efficiency, with a short timeout
    const testRes = await fetch('https://google.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    console.log(`[RAG Worker] DIAGNOSTIC: Basic connectivity test to google.com status: ${testRes.status}`);
  } catch (connectivityError) {
    console.error('[RAG Worker] DIAGNOSTIC: Basic outbound connectivity test FAILED:', connectivityError);
    // Log the specific error cause if available
    if (connectivityError instanceof Error && 'cause' in connectivityError && connectivityError.cause) {
      const causeError = connectivityError.cause as NodeJS.ErrnoException & { hostname?: string };
      console.error(`[RAG Worker] DIAGNOSTIC: Connectivity Test Error Cause: Code=${causeError.code}, Syscall=${causeError.syscall}, Hostname=${causeError.hostname || 'unknown'}`);
    }
    // Consider stopping further execution if basic connectivity fails
    // Uncomment to block processing when basic connectivity fails
    // return NextResponse.json({ error: 'Basic network connectivity failed' }, { status: 500 });
  }
  // --- End of Diagnostic Test ---

  // Log request details
  try {
    console.log('[RAG Worker] Request method:', request.method);
    console.log('[RAG Worker] Request URL:', request.url);
    
    // Log headers without sensitive information
    const safeHeaders = Object.fromEntries(
      Array.from(request.headers.entries())
        .filter(([key]) => !key.includes('auth') && !key.includes('key') && !key.includes('token'))
    );
    console.log('[RAG Worker] Request headers (safe):', safeHeaders);
  } catch (headerError) {
    console.error('[RAG Worker] Error accessing request details:', headerError);
  }

  try {
    // Parse the job payload
    let body;
    try {
      body = await request.json();
      console.log('[RAG Worker] Successfully parsed request body');
    } catch (parseError) {
      console.error('[RAG Worker] Failed to parse request body:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body', details: parseError instanceof Error ? parseError.message : String(parseError) },
        { status: 400 }
      );
    }
    
    console.log('[RAG Worker] Parsed request body:', body);

    // Extract and validate required fields
    const { documentId, userId } = body;

    if (!documentId) {
      console.error('[RAG Worker] Missing documentId in payload:', body);
      return NextResponse.json(
        { error: 'Missing required field: documentId' },
        { status: 400 }
      );
    }
    
    if (!userId) {
      console.error('[RAG Worker] Missing userId in payload:', body);
      return NextResponse.json(
        { error: 'Missing required field: userId' },
        { status: 400 }
      );
    }

    // Verify document exists and check processing status for idempotency
    try {
      console.log(`[RAG Worker] Verifying document ${documentId} exists in database`);
      const document = await getDocumentById({ id: documentId });
      
      if (!document) {
        console.error(`[RAG Worker] Document ${documentId} not found in database`);
        return NextResponse.json(
          { error: `Document ${documentId} not found` },
          { status: 404 }
        );
      }
      
      console.log(`[RAG Worker] Document verification successful: ${document.fileName} (${document.fileType})`);
      
      // Idempotency check: If document is already being processed or completed, don't process again
      // This prevents issues with QStash retries
      if (document.processingStatus === 'processing' || 
          document.processingStatus === 'completed' || 
          document.processingStatus === 'failed') {
        console.log(`[RAG Worker] Document ${documentId} is already in '${document.processingStatus}' state. Skipping processing (likely a retry).`);
        return NextResponse.json(
          { 
            message: `Document already in '${document.processingStatus}' state. Request ignored for idempotency.`,
            status: document.processingStatus,
            idempotencyAction: 'skipped'
          },
          { status: 200 }
        );
      }
    } catch (dbError) {
      console.error(`[RAG Worker] Database error while verifying document:`, dbError);
      // Continue processing - we'll try to process even if the verification check fails
    }

    // Process the document
    console.log(`[RAG Worker] Starting processing for document ${documentId} (user: ${userId})`);
    console.time(`[RAG Worker] document_processing_${documentId}`);
    
    try {
      const success = await processFileForRag({ documentId, userId });
      console.timeEnd(`[RAG Worker] document_processing_${documentId}`);
      
      if (success) {
        const processingTime = new Date().getTime() - startTime.getTime();
        console.log(`[RAG Worker] Successfully processed document ${documentId} in ${processingTime}ms`);
        return NextResponse.json(
          { 
            message: 'Processing completed successfully',
            processingTimeMs: processingTime
          },
          { status: 200 }
        );
      } else {
        console.error(`[RAG Worker] Processing returned false for document ${documentId}`);
        return NextResponse.json(
          { error: 'Processing failed' },
          { status: 500 }
        );
      }
    } catch (processingError) {
      console.timeEnd(`[RAG Worker] document_processing_${documentId}`);
      console.error(`[RAG Worker] Error during document processing:`, processingError);
      
      return NextResponse.json(
        { 
          error: 'Processing error', 
          details: processingError instanceof Error ? processingError.message : String(processingError)
        },
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
  } finally {
    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();
    console.log(`[RAG Worker] Handler completed at ${endTime.toISOString()}`);
    console.log(`[RAG Worker] Total handler duration: ${duration}ms`);
    console.log(`[RAG Worker] ============ HANDLER COMPLETED ============`);
  }
}

// Export the POST handler wrapped by verifySignatureAppRouter
// This automatically loads QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY from env
export const POST = verifySignatureAppRouter(handler); 