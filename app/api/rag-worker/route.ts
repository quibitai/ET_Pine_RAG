import { NextResponse } from 'next/server';
import { processFileForRag } from '@/lib/rag-processor';
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs"; // Use the App Router wrapper
import { getDocumentById } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

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

  // Basic connectivity diagnostic test
  try {
    console.log('[RAG Worker] DIAGNOSTIC: Testing basic outbound connectivity to google.com...');
    // Use HEAD request for efficiency, with a short timeout
    const testRes = await fetch('https://google.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    console.log(`[RAG Worker] DIAGNOSTIC: Basic connectivity test to google.com status: ${testRes.status}`);
    
    // Also test connectivity to api.unstructured.io directly for comparison
    try {
      console.log('[RAG Worker] DIAGNOSTIC: Testing connectivity to api.unstructured.io...');
      const unstructuredRes = await fetch('https://api.unstructured.io', { 
        method: 'HEAD', 
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'Vercel Function Diagnostic' }
      });
      console.log(`[RAG Worker] DIAGNOSTIC: Unstructured API test status: ${unstructuredRes.status}`);
    } catch (unstructuredError) {
      console.error('[RAG Worker] DIAGNOSTIC: Unstructured API connectivity test FAILED:', unstructuredError);
      if (unstructuredError instanceof Error && 'cause' in unstructuredError && unstructuredError.cause) {
        const causeError = unstructuredError.cause as NodeJS.ErrnoException & { hostname?: string };
        console.error(`[RAG Worker] DIAGNOSTIC: Unstructured Test Error Cause: Code=${causeError.code}, Syscall=${causeError.syscall}, Hostname=${causeError.hostname || 'unknown'}`);
      }
    }
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

    // Verify document exists before processing
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
    } catch (dbError) {
      console.error(`[RAG Worker] Database error while verifying document:`, dbError);
      // Continue processing - this was just a verification step
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