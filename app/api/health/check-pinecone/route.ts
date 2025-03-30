import { NextResponse } from 'next/server';
import { getPineconeIndex } from '@/lib/pinecone-client';

export const runtime = 'nodejs';
export const preferredRegion = ['iad1'];
export const dynamic = 'force-dynamic';

/**
 * Health check endpoint to test Pinecone connectivity
 * This can be used to diagnose timeout issues by testing the Pinecone connection separately
 */
export async function GET() {
  const startTime = Date.now();
  console.log('=== Pinecone health check started ===');
  
  try {
    // Get Pinecone client
    console.time('get_pinecone_index');
    const index = getPineconeIndex();
    console.timeEnd('get_pinecone_index');
    
    // Check Pinecone connection with a small test query
    console.time('test_pinecone_query');
    const testVector = new Array(3072).fill(0.1); // Using 3072 dimensions (OpenAI text-embedding-3-large)
    
    const result = await index.query({
      vector: testVector,
      topK: 1,
      includeMetadata: false
    });
    console.timeEnd('test_pinecone_query');
    
    const duration = Date.now() - startTime;
    console.log(`=== Pinecone health check completed successfully in ${duration}ms ===`);
    
    // Return healthy response with timing details
    return NextResponse.json({
      status: 'healthy',
      duration_ms: duration,
      query_result: {
        matches_count: result.matches?.length || 0
      }
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Pinecone health check failed:', error);
    
    // Log error details
    const errorDetails = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack,
    } : 'Unknown error format';
    
    console.error('Error details:', JSON.stringify(errorDetails, null, 2));
    console.log(`=== Pinecone health check failed after ${duration}ms ===`);
    
    // Return error response with timing details
    return NextResponse.json({
      status: 'unhealthy',
      duration_ms: duration,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 