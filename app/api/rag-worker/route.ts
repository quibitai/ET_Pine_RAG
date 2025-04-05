import { NextResponse } from 'next/server';
import { processFileForRag } from '@/lib/rag-processor';
import { generateEmbeddings } from '@/lib/ai/utils';
import { Receiver } from "@upstash/qstash";
import { getDocumentById, incrementProcessedChunks, updateFileRagStatus } from '@/lib/db/queries';
import { Client as QStashClient } from '@upstash/qstash';
import { getPineconeIndex } from '@/lib/pinecone-client';

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

// Initialize QStash verification tools
const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY || '';
const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY || '';
const receiver = new Receiver({
  currentSigningKey: signingKey,
  nextSigningKey
});

// Helper function to verify QStash signature
async function verifySignature(req: Request): Promise<boolean> {
  try {
    // Manual signature verification by creating a new Request
    const signature = req.headers.get('upstash-signature') || '';
    
    // Create a clone of the request with the same body
    const body = await req.text();
    
    // Use the raw verification method instead of verify(request)
    const isValid = await receiver.verify({
      signature,
      body
    });
    
    if (!isValid) {
      return false;
    }
    
    // Parse the body after verification
    const jsonBody = JSON.parse(body);
    
    // Store the parsed body for later use
    (req as any).parsedBody = jsonBody;
    
    return true;
  } catch (error) {
    console.error('[RAG Worker] Signature verification failed:', error);
    return false;
  }
}

export async function POST(req: Request) {
  console.log('[RAG Worker] Received request');

  try {
    // Verify the request signature
    const signatureValid = await verifySignature(req);
    if (!signatureValid) {
      console.error('[RAG Worker] Invalid signature, rejecting request');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    // Body has been parsed during signature verification
    const body = (req as any).parsedBody;
    
    // Check required fields
    if (!body.documentId || !body.userId) {
      console.error('[RAG Worker] Missing required fields', body);
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // Idempotency check
    const document = await getDocumentById({ id: body.documentId });
    if (!document) {
      console.error(`[RAG Worker] Document ${body.documentId} not found`);
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    
    // Check if this is a chunk processing request or initial document processing
    if (body.chunkIndex !== undefined && body.chunkText) {
      // This is a chunk processing request
      console.log(`[RAG Worker] Processing chunk ${body.chunkIndex + 1}/${body.totalChunks} for document ${body.documentId}`);
      
      // Skip if document is already completed
      if (document.processingStatus === 'completed') {
        console.log(`[RAG Worker] Document ${body.documentId} already marked as completed, skipping chunk processing`);
        return NextResponse.json({ message: 'Document already processed' }, { status: 200 });
      }
      
      try {
        // Generate embedding for this chunk
        console.log(`[RAG Worker] Generating embedding for chunk ${body.chunkIndex}`);
        const embedding = await generateEmbeddings(body.chunkText);
        
        // Get Pinecone index
        const index = await getPineconeIndex();
        
        // Create vector ID
        const vectorId = `${body.documentId}_chunk_${body.chunkIndex}`;
        
        // Create metadata
        const metadata = {
          text: body.chunkText,
          documentId: body.documentId,
          userId: body.userId,
          chunkIndex: body.chunkIndex,
          totalChunks: body.totalChunks,
          source: body.documentName,
          timestamp: new Date().toISOString()
        };
        
        // Upsert vector to Pinecone
        console.log(`[RAG Worker] Upserting vector to Pinecone with ID ${vectorId}`);
        await index.upsert([{
          id: vectorId,
          values: embedding,
          metadata
        }]);
        
        // Increment processed chunks count
        const updateResult = await incrementProcessedChunks({ id: body.documentId });
        
        if (updateResult) {
          const processedChunks = updateResult.processedChunks as number;
          const totalChunks = updateResult.totalChunks as number | null;
          
          console.log(`[RAG Worker] Progress: ${processedChunks}/${totalChunks} chunks processed`);
          
          // Check if processing is complete
          if (totalChunks !== null && processedChunks >= totalChunks) {
            // All chunks processed, update document status to completed
            await updateFileRagStatus({
              id: body.documentId,
              processingStatus: 'completed',
              statusMessage: 'All chunks processed and indexed successfully'
            });
            
            console.log(`[RAG Worker] Document ${body.documentId} processing completed`);
          }
        }
        
        // Return success
        return NextResponse.json({
          message: `Chunk ${body.chunkIndex + 1}/${body.totalChunks} processed successfully`,
          progress: updateResult ? {
            processed: updateResult.processedChunks,
            total: updateResult.totalChunks
          } : undefined
        }, { status: 200 });
      } catch (error) {
        console.error(`[RAG Worker] Error processing chunk ${body.chunkIndex}:`, error);
        
        // We don't mark the document as failed for individual chunk failures
        // The document will still have partial results and the UI can show the incomplete status
        
        return NextResponse.json({
          error: `Failed to process chunk ${body.chunkIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`
        }, { status: 500 });
      }
    } else {
      // This is an initial document processing request
      
      // Check if document is already being processed
      if (['processing', 'completed'].includes(document.processingStatus)) {
        console.log(`[RAG Worker] Document ${body.documentId} is already in ${document.processingStatus} state, skipping`);
        return NextResponse.json({ message: `Document processing already ${document.processingStatus}` }, { status: 200 });
      }
      
      // Start document processing
      console.log(`[RAG Worker] Starting initial processing for document ${body.documentId}`);
      
      try {
        // Check if fileExtension was passed in the request
        if (body.fileExtension) {
          console.log(`[RAG Worker] File extension provided in request: ${body.fileExtension}`);
        }
        
        const result = await processFileForRag({ 
          documentId: body.documentId, 
          userId: body.userId,
          fileExtension: body.fileExtension // Pass along the file extension if provided
        });
        return NextResponse.json({
          message: 'Document processing initiated, chunk jobs queued',
          result
        }, { status: 200 });
      } catch (error) {
        console.error(`[RAG Worker] Error initiating document processing:`, error);
        return NextResponse.json({
          error: `Failed to initiate document processing: ${error instanceof Error ? error.message : 'Unknown error'}`
        }, { status: 500 });
      }
    }
  } catch (error) {
    console.error('[RAG Worker] Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 