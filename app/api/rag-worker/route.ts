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

// Simplified debugging version of the POST handler
export async function POST(request: Request): Promise<NextResponse> {
    const startTime = new Date();
    console.log(`[RAG Worker - DEBUG MODE] ============ HANDLER INVOKED ============`);
    console.log(`[RAG Worker - DEBUG MODE] Handler started at ${startTime.toISOString()}`);

    // Log environment and headers
    console.log(`[RAG Worker - DEBUG MODE] Environment: ${process.env.NODE_ENV || 'unknown'}`);
    console.log(`[RAG Worker - DEBUG MODE] Vercel env: ${process.env.VERCEL_ENV || 'not Vercel'}`);
    
    try {
        // Log request details for debugging
        console.log('[RAG Worker - DEBUG MODE] Request method:', request.method);
        console.log('[RAG Worker - DEBUG MODE] Request URL:', request.url);
        
        // Log headers (excluding sensitive ones)
        const safeHeaders = Object.fromEntries(
            Array.from(request.headers.entries())
                .filter(([key]) => !key.includes('auth') && !key.includes('key') && !key.includes('token'))
        );
        console.log('[RAG Worker - DEBUG MODE] Request headers (safe):', safeHeaders);
        
        // Attempt to read the body as JSON directly
        console.log('[RAG Worker - DEBUG MODE] Attempting request.json()...');
        const body = await request.json();
        console.log('[RAG Worker - DEBUG MODE] Successfully parsed body via request.json():', body);

        // If successful, return a success response for debugging
        return NextResponse.json({ status: 'DEBUG_SUCCESS', received_body: body });

    } catch (error) {
        console.error('[RAG Worker - DEBUG MODE] Error reading/parsing request body:', error);
        if (error instanceof Error && error.message.includes('Body has already been read')) {
            console.error('[RAG Worker - DEBUG MODE] Confirmed: Body was already read before handler could parse.');
        }
        // Return an error response for debugging
        return NextResponse.json({ 
            status: 'DEBUG_ERROR', 
            error: error instanceof Error ? error.message : String(error) 
        }, { status: 500 });
    } finally {
        const endTime = new Date();
        const duration = endTime.getTime() - startTime.getTime();
        console.log(`[RAG Worker - DEBUG MODE] Handler completed at ${endTime.toISOString()} (Duration: ${duration}ms)`);
        console.log(`[RAG Worker - DEBUG MODE] ============ HANDLER COMPLETED ============`);
    }
} 