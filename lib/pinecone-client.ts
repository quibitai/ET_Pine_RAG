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

// Configuration constants for timeouts and retries
const CONFIG = {
  MAX_RETRY_ATTEMPTS: 3,
  CONNECTION_TIMEOUT_MS: 15000, // 15 seconds
  OPERATION_TIMEOUT_MS: 25000,  // 25 seconds
  RETRY_DELAY_MS: 1000,         // Initial delay between retries (1 second)
};

// --- Helper function for exponential backoff retry logic ---
async function withRetry<T>(
  operation: () => Promise<T>,
  options?: { 
    maxRetries?: number,
    initialDelay?: number,
    operationName?: string 
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? CONFIG.MAX_RETRY_ATTEMPTS;
  const initialDelay = options?.initialDelay ?? CONFIG.RETRY_DELAY_MS;
  const operationName = options?.operationName ?? 'Pinecone operation';
  
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Retry attempt ${attempt}/${maxRetries} for ${operationName}...`);
      }
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        // Calculate exponential backoff with jitter
        const delay = initialDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
        console.log(`${operationName} failed (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`${operationName} failed after ${maxRetries} attempts.`);
      }
    }
  }
  
  throw lastError;
}

/**
 * Test function to verify Pinecone connection and index access
 * This is important to validate that the API key and index name are correct
 */
async function testPineconeConnection(client: Pinecone, indexName: string): Promise<boolean> {
  console.log('🔍 Testing Pinecone connection...');
  try {
    // Test 1: List indexes to verify API key has correct permissions
    console.time('pinecone_list_indexes');
    try {
      const indexesList = await client.listIndexes();
      const foundIndex = indexesList.indexes?.find(idx => idx.name === indexName);
      console.timeEnd('pinecone_list_indexes');
      console.log(`Available indexes: ${indexesList.indexes?.map(i => i.name).join(', ')}`);
      
      if (!foundIndex) {
        console.error(`❌ Index "${indexName}" NOT FOUND in available indexes!`);
        console.log(`Available indexes: ${indexesList.indexes?.map(i => i.name).join(', ') || 'none'}`);
        return false;
      }
      
      console.log(`✅ Index "${indexName}" found in available indexes.`);
    } catch (error) {
      console.timeEnd('pinecone_list_indexes');
      console.error('❌ Failed to list Pinecone indexes:', error);
      return false;
    }
    
    // Test 2: Try to get the index
    const index = client.index(indexName);
    
    // Test 3: Describe the index
    console.time('pinecone_describe_index');
    try {
      const stats = await index.describeIndexStats();
      console.timeEnd('pinecone_describe_index');
      
      console.log('✅ Successfully connected to Pinecone index:');
      console.log(`- Total vectors: ${stats.totalRecordCount}`);
      console.log(`- Dimensions: ${stats.dimension || 'unknown'}`);
      console.log(`- Namespaces: ${Object.keys(stats.namespaces || {}).length}`);
      
      return true;
    } catch (error) {
      console.timeEnd('pinecone_describe_index');
      console.error('❌ Error describing index:', error);
      console.error('This suggests the index exists but there may be permission or network issues');
      return false;
    }
  } catch (error) {
    console.error('❌ Unexpected error testing Pinecone connection:', error);
    return false;
  }
}

// --- Initialize Client (Minimal Config) ---
console.log('Initializing Pinecone client with: apiKey only (minimal config)');
let pineconeInstance: Pinecone;
try {
  // Initialize with ONLY the apiKey
  pineconeInstance = new Pinecone({
    apiKey: API_KEY,
    // Fetch options removed due to type compatibility issues
    // We'll use controller.signal directly in the query method instead
  });
  
  // Test connection right after initialization
  // Use top-level await or wrap in an IIFE
  (async () => {
    try {
      if (INDEX_NAME) {
        const connectionSuccessful = await testPineconeConnection(pineconeInstance, INDEX_NAME);
        if (connectionSuccessful) {
          console.log('✅ Pinecone connection test SUCCESSFUL');
        } else {
          console.error('⚠️ Pinecone connection test FAILED - check your API key, index name, and network');
        }
      }
    } catch (error) {
      console.error('Error during Pinecone connection test:', error);
    }
  })().catch(error => {
    console.error('Unhandled error in Pinecone connection test:', error);
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
 * Enhanced query function with timing, error logging, and retry logic
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
    
    // Use retry logic for the query operation
    console.time('pinecone_api_call');
    const queryResponse = await withRetry(
      async () => {
        // Create timeout to abort if operation takes too long
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Pinecone query timed out after ${CONFIG.OPERATION_TIMEOUT_MS}ms`));
          }, CONFIG.OPERATION_TIMEOUT_MS);
        });

        // Actual query operation
        const queryPromise = index.query({
          vector: queryVector,
          topK,
          filter,
          includeMetadata: true,
        });
        
        // Race between timeout and query
        return await Promise.race([
          queryPromise,
          timeoutPromise
        ]) as Awaited<typeof queryPromise>;
      },
      { operationName: 'Pinecone query' }
    );
    
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