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
    // --- TEMPORARY DIAGNOSTIC ---
    console.log('[RAG Worker] Testing external connectivity to google.com...');
    try {
      const testResponse = await fetch('https://google.com', { method: 'HEAD' });
      console.log(`[RAG Worker] Test fetch to google.com status: ${testResponse.status}`);
      
      // Also test connectivity to Unstructured API
      console.log('[RAG Worker] Testing connectivity to api.unstructured.io...');
      const unstructuredTestResponse = await fetch('https://api.unstructured.io', { 
        method: 'HEAD',
        headers: { 'User-Agent': 'Vercel Function Connectivity Test' }
      });
      console.log(`[RAG Worker] Test fetch to api.unstructured.io status: ${unstructuredTestResponse.status}`);
    } catch (testError) {
      console.error('[RAG Worker] ❌ FAILED test fetch:', testError);
      // Check error properties, handling potential unknown type
      const errorObj = testError as { code?: string };
      if (errorObj.code === 'ENOTFOUND') {
        console.error('[RAG Worker] This appears to be a DNS resolution issue - the hostname could not be found');
      } else if (errorObj.code === 'ECONNREFUSED') {
        console.error('[RAG Worker] This appears to be a connection issue - the server actively refused the connection');
      }
    }
    // --- END TEMPORARY DIAGNOSTIC ---

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