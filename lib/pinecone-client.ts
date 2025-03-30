import { Pinecone } from '@pinecone-database/pinecone';

const INDEX_NAME = process.env.PINECONE_INDEX_NAME;
const API_KEY = process.env.PINECONE_API_KEY;
const ENVIRONMENT = process.env.PINECONE_ENVIRONMENT;
const INDEX_HOST = process.env.PINECONE_INDEX_HOST || 'https://et-mf0m9e4.svc.aped-4627-b74a.pinecone.io';

// --- Add Diagnostic Logging ---
console.log("--- Pinecone Env Vars Check ---");
console.log(`- PINECONE_API_KEY present: ${!!API_KEY}`); // Log presence, not the key itself for security
console.log(`- PINECONE_INDEX_NAME: ${INDEX_NAME}`);
console.log(`- PINECONE_ENVIRONMENT: ${ENVIRONMENT}`);
console.log(`- PINECONE_INDEX_HOST: ${INDEX_HOST}`);
console.log(`- Using OpenAI text-embedding-3-large (3072 dimensions)`);
console.log("-----------------------------");
// --- End Logging ---

// --- Environment Variable Validation ---
if (!API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable is not defined.');
}
if (!INDEX_NAME) {
   throw new Error('PINECONE_INDEX_NAME environment variable is not defined.');
}
// You can keep or remove the other checks/warnings for INDEX_HOST/ENVIRONMENT
// as they won't affect the constructor call directly in this approach.

// --- Initialize Client (Minimal Config) ---
console.log('Initializing Pinecone client with: apiKey only (minimal config)');
let pineconeInstance: Pinecone;
try {
  // Initialize with ONLY the apiKey
  pineconeInstance = new Pinecone({
    apiKey: API_KEY,
  });
} catch (e) {
   console.error("Error during Pinecone client minimal initialization:", e);
   // If even this minimal init fails, re-throw to see the error
   throw e;
}

// Export the initialized instance
export const pineconeClient = pineconeInstance;

// --- Helper Function with Enhanced Logging ---
export const getPineconeIndex = () => {
  // Re-check index name here just in case, though checked above
  if (!INDEX_NAME) {
     throw new Error('PINECONE_INDEX_NAME is missing, cannot get index.');
  }
  console.log(`Getting Pinecone index: ${INDEX_NAME}`);
  return pineconeClient.index(INDEX_NAME);
};

/**
 * Enhanced query function with timing and error logging
 * This wrapper adds detailed diagnostics around Pinecone operations
 */
export async function queryPineconeWithDiagnostics(
  indexName: string,
  queryVector: number[],
  topK: number = 5,
  filter?: Record<string, any>
) {
  if (!indexName) {
    throw new Error('Index name is required');
  }

  if (!queryVector || !queryVector.length) {
    throw new Error('Query vector is required and must not be empty');
  }

  console.time('pinecone_query_total');
  console.log(`=== Starting Pinecone query (index: ${indexName}) ===`);
  console.log(`Query parameters: topK=${topK}, filter=${filter ? JSON.stringify(filter) : 'none'}`);
  console.log(`Vector dimensions: ${queryVector.length}`);

  try {
    const index = pineconeClient.index(indexName);
    
    console.time('pinecone_api_call');
    const queryResponse = await index.query({
      vector: queryVector,
      topK,
      filter,
      includeMetadata: true,
    });
    console.timeEnd('pinecone_api_call');
    
    const matchCount = queryResponse.matches?.length || 0;
    console.log(`Query successful. Found ${matchCount} matches.`);
    
    // Log match scores if available (helpful for relevance debugging)
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log('Match scores:');
      queryResponse.matches.forEach((match, i) => {
        console.log(`  Match ${i+1}: score=${match.score}, id=${match.id}`);
      });
    }
    
    console.timeEnd('pinecone_query_total');
    console.log('=== Pinecone query completed successfully ===');
    
    return queryResponse;
  } catch (error) {
    console.timeEnd('pinecone_api_call');
    console.error('Error querying Pinecone:', error);
    
    // Enhanced error details
    const errorDetails = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack,
    } : 'Unknown error format';
    
    console.error('Error details:', JSON.stringify(errorDetails, null, 2));
    console.timeEnd('pinecone_query_total');
    console.log('=== Pinecone query failed ===');
    
    throw error;
  }
} 