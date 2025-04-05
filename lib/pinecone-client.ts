import { Pinecone } from '@pinecone-database/pinecone';

const INDEX_NAME = process.env.PINECONE_INDEX_NAME;
const API_KEY = process.env.PINECONE_API_KEY;
const ENVIRONMENT = process.env.PINECONE_ENVIRONMENT;
const INDEX_HOST = process.env.PINECONE_INDEX_HOST;

// --- Add Diagnostic Logging ---
console.log("--- Pinecone Env Vars Check ---");
console.log(`- PINECONE_API_KEY present: ${!!API_KEY}`); // Log presence, not the key itself for security
console.log(`- PINECONE_INDEX_NAME: ${INDEX_NAME}`);
console.log(`- PINECONE_ENVIRONMENT: ${ENVIRONMENT}`);

// Enhanced host validation and logging
if (!INDEX_HOST) {
  console.error('⚠️ CRITICAL: PINECONE_INDEX_HOST environment variable is not set');
  console.error('Connection to Pinecone index will likely fail');
  console.error('Note: While Pinecone SDK v2.x does not use this directly in the client constructor,'); 
  console.error('it is still required for some operations and diagnostics in your application');
} else {
  // Check if the host URL is properly formatted
  try {
    const hostUrl = new URL(INDEX_HOST);
    console.log(`- PINECONE_INDEX_HOST: ${INDEX_HOST}`);
    console.log(`- Host validation: Protocol=${hostUrl.protocol}, Domain=${hostUrl.hostname}`);
    console.log('- Note: Pinecone SDK v2.x does not use this host directly in client initialization');
    console.log('  but your application may use it for diagnostics or other operations');
    
    // Further validations
    if (!hostUrl.hostname.includes('.svc.')) {
      console.warn(`⚠️ WARNING: Pinecone host URL doesn't contain '.svc.' which is typical in Pinecone hosts`);
    }
    if (!hostUrl.hostname.includes('pinecone.io')) {
      console.warn(`⚠️ WARNING: Pinecone host URL doesn't end with 'pinecone.io' which is typical in Pinecone hosts`);
    }
  } catch (urlError) {
    console.error(`❌ ERROR: PINECONE_INDEX_HOST value "${INDEX_HOST}" is not a valid URL`);
  }
}

console.log(`- Using OpenAI text-embedding-3-large (3072 dimensions)`);
console.log(`- IMPORTANT: Ensure your Pinecone index "${INDEX_NAME}" is configured for 3072 dimensions`);
console.log(`- If you see dimension mismatch errors, recreate your index with 3072 dimensions`);
console.log("-----------------------------");
// --- End Logging ---

// --- Environment Variable Validation ---
if (!API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable is not defined.');
}
if (!INDEX_NAME) {
   throw new Error('PINECONE_INDEX_NAME environment variable is not defined.');
}
if (!INDEX_HOST) {
  throw new Error('PINECONE_INDEX_HOST environment variable is not defined. This is required for connecting to your Pinecone index.');
}

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
        console.warn(`TROUBLESHOOTING: 
          1. Check that "${indexName}" is spelled correctly (case-sensitive).
          2. Verify your API key has access to this index.
          3. Ensure the index exists and hasn't been deleted.
        `);
        return false;
      }
      
      console.log(`✅ Index "${indexName}" found in available indexes.`);
    } catch (error) {
      console.timeEnd('pinecone_list_indexes');
      console.error('❌ Failed to list Pinecone indexes:', error);
      console.error(`TROUBLESHOOTING API KEY ERROR:
        1. Your API key may be invalid or expired.
        2. Your API key may not have permission to list indexes.
        3. Check for network issues or Pinecone service outages.
      `);
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
      
      // Check for dimension mismatch
      if (stats.dimension && stats.dimension !== 3072) {
        console.error(`❌ CRITICAL DIMENSION MISMATCH: Your Pinecone index has ${stats.dimension} dimensions, but OpenAI text-embedding-3-large produces 3072 dimensions.`);
        console.error(`This will cause errors when storing or querying vectors. You need to recreate your Pinecone index with 3072 dimensions.`);
        console.warn(`To fix: Go to https://app.pinecone.io, delete the index "${indexName}", and create a new one with 3072 dimensions.`);
        // We still return true because connection succeeded, but the user needs to fix this
      } else if (stats.dimension && stats.dimension === 3072) {
        console.log('✅ Dimension check passed: Index dimension matches OpenAI text-embedding-3-large (3072)');
      }
      
      return true;
    } catch (error) {
      console.timeEnd('pinecone_describe_index');
      console.error('❌ Error describing index:', error);
      
      // Provide specific troubleshooting based on error type
      if (error instanceof Error) {
        if (error.message.includes('Failed to connect')) {
          console.error(`TROUBLESHOOTING HOST CONNECTION ERROR:
            1. Verify your PINECONE_INDEX_HOST is correct: ${process.env.PINECONE_INDEX_HOST}
            2. Go to https://app.pinecone.io, open your index "${indexName}", and compare the Host URL
            3. IMPORTANT: The host URL should look like: "https://[index-name]-[random-id].svc.[region].pinecone.io"
            4. Copy the exact Host URL from the Pinecone console and update your environment variable
            5. Check for network/firewall issues blocking connections to Pinecone
          `);
        } else if (error.message.includes('not found') || error.message.includes('404')) {
          console.error(`TROUBLESHOOTING INDEX NOT FOUND:
            1. Your index "${indexName}" may not exist at the host URL: ${process.env.PINECONE_INDEX_HOST}
            2. Each index has its own unique host URL - make sure you're using the host for this specific index
            3. Go to Pinecone console and verify the correct host URL for index "${indexName}"
          `);
        } else {
          console.error(`GENERAL TROUBLESHOOTING:
            1. Check your Pinecone environment variables
            2. Verify your index is in "Ready" state in the Pinecone console
            3. Ensure your account has sufficient quota for this index
          `);
        }
      }
      
      console.error('This suggests the index exists but there may be permission or network issues');
      return false;
    }
  } catch (error) {
    console.error('❌ Unexpected error testing Pinecone connection:', error);
    return false;
  }
}

// --- Initialize Client with API key only ---
console.log('Initializing Pinecone client with API key only...');
let pineconeInstance: Pinecone;
try {
  // Initialize ONLY with apiKey - do not include host property
  pineconeInstance = new Pinecone({
    apiKey: API_KEY
    // DO NOT pass host: INDEX_HOST here - it causes validation errors in Pinecone client v2.x
  });
  
  // Test connection right after initialization
  // Use top-level await or wrap in an IIFE
  (async () => {
    try {
      if (INDEX_NAME) {
        console.log(`Testing connection to Pinecone index '${INDEX_NAME}' at host '${INDEX_HOST}'...`);
        const connectionSuccessful = await testPineconeConnection(pineconeInstance, INDEX_NAME);
        if (connectionSuccessful) {
          console.log('✅ Pinecone connection test SUCCESSFUL');
        } else {
          console.error('⚠️ Pinecone connection test FAILED - check your API key, index name, and host URL');
          console.log('Note: The host URL is required in your environment variables but NOT used in client initialization');
          console.log('Pinecone SDK v2.x automatically discovers the correct host based on index name');
        }
      }
    } catch (error) {
      console.error('Error during Pinecone connection test:', error);
    }
  })().catch(error => {
    console.error('Unhandled error in Pinecone connection test:', error);
  });
  
} catch (e) {
   console.error("Error during Pinecone client initialization:", e);
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

  // Check vector dimensions
  const EXPECTED_DIMENSIONS = 3072; // OpenAI text-embedding-3-large produces 3072 dimensions
  if (queryVector.length !== EXPECTED_DIMENSIONS) {
    console.error(`❌ DIMENSION MISMATCH: Query vector has ${queryVector.length} dimensions, but index expects ${EXPECTED_DIMENSIONS} dimensions`);
    console.error('This is likely because you are using a different embedding model than OpenAI text-embedding-3-large');
    console.error('Check your embedding generation code to ensure it uses OpenAI text-embedding-3-large');
  }

  console.time('pinecone_query_total');
  console.log(`=== Starting Pinecone query (index: ${indexName}) ===`);
  console.log(`Query parameters: topK=${topK}, filter=${filter ? JSON.stringify(filter) : 'none'}`);
  console.log(`Vector dimensions: ${queryVector.length}, Expected: ${EXPECTED_DIMENSIONS}`);

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