import { getPineconeIndex } from './pinecone-client';
import { generateEmbeddings } from './ai/utils';
import { updateFileRagStatus, getDocumentById } from './db/queries';
import { randomUUID } from 'crypto';
import type { PineconeRecord, RecordMetadata } from '@pinecone-database/pinecone';

/**
 * Splits text into chunks of specified size with overlap
 * @param text Text to split
 * @param chunkSize Maximum size of each chunk
 * @param overlap Number of characters to overlap between chunks
 * @returns Array of text chunks
 */
function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  let i = 0;
  
  while (i < text.length) {
    // If we're near the end, just take the remaining text
    if (i + chunkSize >= text.length) {
      chunks.push(text.slice(i));
      break;
    }
    
    // Find a good breaking point (end of sentence or paragraph)
    let end = i + chunkSize;
    const breakPoints = ['. ', '? ', '! ', '\n\n'];
    let bestBreakPoint = end;
    
    for (const breakPoint of breakPoints) {
      const pos = text.lastIndexOf(breakPoint, end);
      if (pos > i && pos < end) {
        bestBreakPoint = pos + breakPoint.length;
      }
    }
    
    chunks.push(text.slice(i, bestBreakPoint));
    i = bestBreakPoint - overlap;
  }
  
  return chunks;
}

// Interface for Unstructured API Response
interface UnstructuredElement {
  type: string;
  text: string;
  metadata: {
    filename?: string;
    page_number?: number;
  };
}

/**
 * Extracts text from a document using the Unstructured API
 * @param fileUrl URL of the file to process
 * @param apiKey Unstructured API key
 * @returns Object containing extracted elements and full text
 */
async function extractTextWithUnstructured(
  fileUrl: string,
  apiKey: string
): Promise<{ elements: UnstructuredElement[]; fullText: string }> {
  console.log(`[Unstructured] Starting extraction for URL: ${fileUrl.split('?')[0]}`);
  
  // Primary and fallback API endpoints
  const apiHostname = "api.unstructured.io";
  // IP address fallbacks (current as of latest DNS lookup)
  const apiFallbackIPs = ["4.227.53.74", "48.216.143.214"]; // Current IPs for api.unstructured.io
  const apiFallbackIP = apiFallbackIPs[0]; // Use the first IP as primary fallback
  const apiPath = "/general/v0/general";
  
  let apiUrl = `https://${apiHostname}${apiPath}`;
  let usedFallbackIP = false;

  // Log DNS resolution attempt
  console.log(`[Unstructured] Attempting to resolve DNS for ${apiHostname}...`);
  
  const requestData = {
    url: fileUrl,
    strategy: "auto",
    pdf_infer_table_structure: "true",
  };

  try {
    // First, test API availability with a simple HEAD request
    let dnsResolutionFailed = false;
    
    try {
      console.log(`[Unstructured] Testing API availability with HEAD request...`);
      const testResponse = await fetch(`https://${apiHostname}`, {
        method: "HEAD",
        headers: { "User-Agent": "Vercel Function Connectivity Test" },
        // Add a reasonable timeout
        signal: AbortSignal.timeout(5000) // 5 second timeout for the test
      });
      console.log(`[Unstructured] API availability test result: ${testResponse.status} ${testResponse.statusText}`);
    } catch (testError) {
      // Log but don't fail - this is just a pre-check
      console.error(`[Unstructured] API availability test failed:`, testError);
      const errorObj = testError as { name?: string, code?: string, cause?: Error };
      
      if (errorObj.name === 'AbortError') {
        console.error(`[Unstructured] API availability test timed out after 5 seconds`);
      } else if (errorObj.code === 'ENOTFOUND') {
        console.error(`[Unstructured] DNS resolution failed - Cannot resolve ${apiHostname}`);
        console.error(`[Unstructured] Will try fallback to direct IP address: ${apiFallbackIP}`);
        dnsResolutionFailed = true;
        
        // Switch to IP address fallback
        apiUrl = `https://${apiFallbackIP}${apiPath}`;
        usedFallbackIP = true;
        
        // Test the IP fallback
        try {
          console.log(`[Unstructured] Testing fallback IP connectivity...`);
          const ipTestResponse = await fetch(`https://${apiFallbackIP}`, {
            method: "HEAD",
            headers: { 
              "User-Agent": "Vercel Function Connectivity Test",
              // Add Host header to handle TLS certificate validation
              "Host": apiHostname 
            },
            signal: AbortSignal.timeout(5000)
          });
          console.log(`[Unstructured] Fallback IP test result: ${ipTestResponse.status} ${ipTestResponse.statusText}`);
        } catch (ipTestError) {
          console.error(`[Unstructured] Fallback IP test also failed:`, ipTestError);
          // Continue anyway - this is just a pre-check
        }
      }
    }

    // Proceed with the main API call
    console.time('unstructured_api_call');
    console.log(`[Unstructured] Making POST request to ${apiUrl}`);
    
    // Create an AbortController for the main request with a longer timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
    try {
      // Prepare headers including Host header if using IP fallback
      const headers: Record<string, string> = {
        "accept": "application/json",
        "Content-Type": "application/json",
        "unstructured-api-key": apiKey,
      };
      
      // Add Host header if using IP fallback to handle TLS certificate validation
      if (usedFallbackIP) {
        headers["Host"] = apiHostname;
      }
      
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(requestData),
        signal: controller.signal
      });
      
      // Clear the timeout since the request completed
      clearTimeout(timeoutId);
      
      console.timeEnd('unstructured_api_call');
      
      console.log(`[Unstructured] Response status: ${response.status} ${response.statusText}`);
      console.log(`[Unstructured] Response headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Unstructured] API Error ${response.status}: ${errorBody}`);
        throw new Error(`Unstructured API failed with status ${response.status}: ${errorBody}`);
      }

      const elements: UnstructuredElement[] = await response.json();
      console.log(`[Unstructured] Successfully processed. Received ${elements.length} elements.`);

      if (!Array.isArray(elements)) {
        console.error("[Unstructured] API response was not an array:", elements);
        throw new Error("Invalid response format from Unstructured API");
      }

      const fullText = elements.map(el => el.text || '').join('\n\n');
      console.log(`[Unstructured] Total extracted text length: ${fullText.length}`);

      return { elements, fullText };
    } catch (fetchError) {
      // Handle fetch-specific errors
      clearTimeout(timeoutId);
      
      // Add detailed logging for fetch errors including 'cause' property
      console.error(`[Unstructured] Fetch error details for ${apiUrl}:`, fetchError);
      
      // Define NetworkError type for better typing
      type NetworkError = { 
        name?: string; 
        code?: string; 
        cause?: any;
        message?: string;
        stack?: string;
        hostname?: string;
        syscall?: string;
      };
      
      const errorObj = fetchError as NetworkError;
      
      // Log the cause property for detailed network errors
      if ('cause' in errorObj && errorObj.cause) {
        console.error(`[Unstructured] Fetch Error Cause Details:`, JSON.stringify(errorObj.cause, null, 2));
        // Try to access common network error properties
        const causeObj = errorObj.cause as NetworkError;
        if(causeObj.code) console.error(`[Unstructured] Cause Code: ${causeObj.code}`);
        if(causeObj.syscall) console.error(`[Unstructured] Cause Syscall: ${causeObj.syscall}`);
        if(causeObj.hostname) console.error(`[Unstructured] Cause Hostname: ${causeObj.hostname}`);
      }
      
      if (errorObj.name === 'AbortError') {
        console.error(`[Unstructured] Request timed out after 60 seconds`);
        throw new Error(`Unstructured API request timed out after 60 seconds`);
      } else if (errorObj.code === 'ENOTFOUND') {
        if (!usedFallbackIP) {
          console.error(`[Unstructured] Primary DNS resolution failed - Cannot resolve ${apiHostname}`);
          console.error(`[Unstructured] Attempting to use IP fallbacks for retry...`);
          
          // Try each fallback IP in sequence
          for (let i = 0; i < apiFallbackIPs.length; i++) {
            const currentFallbackIP = apiFallbackIPs[i];
            apiUrl = `https://${currentFallbackIP}${apiPath}`;
            usedFallbackIP = true;
            
            // Try with this fallback IP
            console.log(`[Unstructured] Retrying request with IP address ${currentFallbackIP} (attempt ${i+1}/${apiFallbackIPs.length})...`);
            
            const fallbackController = new AbortController();
            const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), 60000);
            
            try {
              const fallbackResponse = await fetch(apiUrl, {
                method: "POST",
                headers: {
                  "accept": "application/json",
                  "Content-Type": "application/json",
                  "unstructured-api-key": apiKey,
                  "Host": apiHostname // Add Host header for TLS certificate validation
                },
                body: JSON.stringify(requestData),
                signal: fallbackController.signal
              });
              
              clearTimeout(fallbackTimeoutId);
              
              if (!fallbackResponse.ok) {
                const fallbackErrorBody = await fallbackResponse.text();
                console.error(`[Unstructured] Fallback API call to ${currentFallbackIP} failed with status ${fallbackResponse.status}: ${fallbackErrorBody}`);
                // Continue to next IP if available
                continue;
              }
              
              // Success with this fallback IP
              console.log(`[Unstructured] Fallback API call to ${currentFallbackIP} succeeded!`);
              const fallbackElements: UnstructuredElement[] = await fallbackResponse.json();
              console.log(`[Unstructured] Received ${fallbackElements.length} elements.`);
              
              const fallbackFullText = fallbackElements.map(el => el.text || '').join('\n\n');
              return { elements: fallbackElements, fullText: fallbackFullText };
            } catch (fallbackError) {
              clearTimeout(fallbackTimeoutId);
              console.error(`[Unstructured] Fallback API call to ${currentFallbackIP} failed:`, fallbackError);
              // Log detailed error for this fallback attempt
              if (fallbackError instanceof Error && 'cause' in fallbackError && fallbackError.cause) {
                console.error(`[Unstructured] Fallback Error Cause for ${currentFallbackIP}:`, 
                  JSON.stringify(fallbackError.cause, null, 2));
              }
              // Continue to next IP if available
            }
          }
          
          // If we get here, all fallbacks failed
          console.error(`[Unstructured] All fallback IPs failed - this is a critical network issue`);
          throw new Error(`Failed to connect to Unstructured API after trying hostname and ${apiFallbackIPs.length} fallback IPs.`);
        } else {
          console.error(`[Unstructured] Both hostname and IP fallback failed - this is a critical network issue`);
          throw new Error(`Critical network issue: Cannot connect to Unstructured API via hostname or IP address. This is likely a network connectivity issue in the Vercel environment.`);
        }
      }
      
      // Re-throw the original error
      throw fetchError;
    }
  } catch (error) {
    console.error("[Unstructured] Failed to process document:", error);
    // Add more context to the error
    if (error instanceof Error) {
      console.error("[Unstructured] Error name:", error.name);
      console.error("[Unstructured] Error message:", error.message);
      console.error("[Unstructured] Error stack:", error.stack);
      
      // Log the 'cause' property for detailed DNS/network errors
      if ('cause' in error && error.cause) {
        // Create a more specific type that includes hostname
        type NetworkError = NodeJS.ErrnoException & { 
          hostname?: string; 
        };
        
        const causeError = error.cause as NetworkError; // Type assertion
        console.error(`[Unstructured] Error Cause Details:`, JSON.stringify(error.cause, null, 2));
        if(causeError.code) console.error(`[Unstructured] Cause Code: ${causeError.code}`); // Should be ENOTFOUND
        if(causeError.syscall) console.error(`[Unstructured] Cause Syscall: ${causeError.syscall}`); // e.g., 'getaddrinfo'
        if(causeError.hostname) console.error(`[Unstructured] Cause Hostname: ${causeError.hostname}`); // The hostname that failed lookup
      }
      
      // Create a more descriptive error
      const enhancedError = new Error(`Unstructured API error: ${error.message}`);
      enhancedError.stack = error.stack;
      throw enhancedError;
    } else {
      console.error(`[Unstructured] Caught non-Error object:`, JSON.stringify(error, null, 2));
      throw error;
    }
  }
}

/**
 * Processes a document for RAG
 * @param documentId ID of the document to process
 * @param userId ID of the user who uploaded the file
 */
export async function processFileForRag({
  documentId,
  userId,
}: {
  documentId: string;
  userId: string;
}): Promise<boolean> {
  console.time('total_rag_processing');
  console.log(`[RAG Processor] Starting RAG processing for document ${documentId}`);
  
  let docDetails;
  let allUpsertsSucceeded = true;
  let firstErrorMessage: string | undefined;
  let totalChunksProcessed = 0;
  let successfullyUpsertedChunks = 0;
  let failedUpsertBatches = 0;

  try {
    // Validate Unstructured API Key
    const unstructuredApiKey = process.env.UNSTRUCTURED_API_KEY;
    if (!unstructuredApiKey) {
      throw new Error('UNSTRUCTURED_API_KEY environment variable is not set');
    }

    // Get document details
    console.log(`[RAG Processor] Fetching document details for ${documentId}`);
    docDetails = await getDocumentById({ id: documentId });
    if (!docDetails) {
      throw new Error(`Document not found: ${documentId}`);
    }
    console.log(`[RAG Processor] Successfully fetched details for ID: ${documentId}. FileName: ${docDetails?.fileName}`);

    const { fileName: documentName, fileUrl, fileType } = docDetails;
    if (!fileUrl) {
      throw new Error('Document has no associated file URL');
    }

    // Update status to processing
    console.log(`[RAG Processor] Updating status to 'processing' for ${documentId}`);
    try {
      await updateFileRagStatus({
        id: documentId,
        processingStatus: 'processing',
        statusMessage: 'Starting document processing'
      });
      console.log(`[RAG Processor] ✅ Successfully updated status to 'processing'`);
    } catch (statusError) {
      console.error(`[RAG Processor] ❌ Failed to update status to 'processing':`, statusError);
      throw statusError;
    }

    // Extract text using Unstructured API
    console.log(`[RAG Processor] Sending URL to Unstructured API for ${documentId}`);
    const { elements, fullText } = await extractTextWithUnstructured(fileUrl, unstructuredApiKey);
    console.log(`[RAG Processor] Text extraction via Unstructured completed for ${documentId}`);

    // Process text chunks
    console.log("[RAG Processor] Using local chunkText function.");
    if (!fullText || fullText.trim().length === 0) {
      throw new Error('No meaningful text extracted from document via Unstructured.');
    }
    const textChunks = chunkText(fullText);
    console.log(`[RAG Processor] Prepared ${textChunks.length} chunks for embedding.`);

    // Initialize Pinecone
    const index = await getPineconeIndex();
    
    // Process chunks in batches
    const batchSize = 5; // Reduced batch size to prevent rate limiting
    const batches = [];
    for (let i = 0; i < textChunks.length; i += batchSize) {
      batches.push(textChunks.slice(i, i + batchSize));
    }
    console.log(`[RAG Processor] Processing ${batches.length} batches of up to ${batchSize} chunks each`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const vectors = [];
      
      console.log(`[RAG Processor] Processing batch ${batchIndex + 1}/${batches.length}`);
      
      // Generate embeddings for batch
      for (let i = 0; i < batch.length; i++) {
        const chunkIndex = batchIndex * batchSize + i;
        const chunk = batch[i];
        
        console.log(`[RAG Processor] Generating embedding for chunk ${chunkIndex + 1}/${textChunks.length}`);
        console.time(`chunk_${chunkIndex}_embedding`);
        const embedding = await generateEmbeddings(chunk);
        console.timeEnd(`chunk_${chunkIndex}_embedding`);
        
        if (embedding) {
          const vectorId = `${documentId}_chunk_${chunkIndex + 1}`;
          const metadata = {
            text: chunk,
            documentId,
            chunkIndex: chunkIndex + 1,
            totalChunks: textChunks.length,
            source: documentName || 'unknown',
            timestamp: new Date().toISOString(),
          };
          
          vectors.push({
            id: vectorId,
            values: embedding,
            metadata,
          });
          
          console.log(`[RAG Processor] ✅ Successfully generated embedding for chunk ${chunkIndex + 1}`);
        } else {
          console.error(`[RAG Processor] ❌ Failed to generate embedding for chunk ${chunkIndex + 1}`);
          allUpsertsSucceeded = false;
          firstErrorMessage = firstErrorMessage || `Failed to generate embedding for chunk ${chunkIndex + 1}`;
        }
        
        totalChunksProcessed++;
      }
      
      // Upsert batch to Pinecone with retries
      if (vectors.length > 0) {
        const maxRetries = 3;
        let retryCount = 0;
        let upsertSuccess = false;
        
        while (retryCount < maxRetries && !upsertSuccess) {
          try {
            console.log(`[RAG Processor] Upserting batch ${batchIndex + 1} to Pinecone (Attempt ${retryCount + 1}/${maxRetries})`);
            console.time(`batch_${batchIndex}_upsert`);
            await index.upsert(vectors as PineconeRecord<RecordMetadata>[]);
            console.timeEnd(`batch_${batchIndex}_upsert`);
            
            successfullyUpsertedChunks += vectors.length;
            upsertSuccess = true;
            console.log(`[RAG Processor] ✅ Successfully upserted batch ${batchIndex + 1}`);
          } catch (error) {
            retryCount++;
            console.error(`[RAG Processor] ❌ Failed to upsert batch ${batchIndex + 1} (Attempt ${retryCount}/${maxRetries}):`, error);
            
            if (retryCount < maxRetries) {
              const delay = 1000 * retryCount; // Exponential backoff
              console.log(`[RAG Processor] Retrying batch ${batchIndex + 1} after ${delay}ms delay...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              allUpsertsSucceeded = false;
              failedUpsertBatches++;
              firstErrorMessage = firstErrorMessage || `Failed to upsert batch ${batchIndex + 1} after ${maxRetries} attempts`;
            }
          }
        }
      }
      
      // Add delay between batches to prevent rate limiting
      if (batchIndex < batches.length - 1) {
        console.log(`[RAG Processor] Waiting 1000ms before processing next batch...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Log final statistics
    console.timeEnd('total_rag_processing');
    console.log('\n[RAG Processor] === Final Processing Statistics ===');
    console.log(`Total chunks processed: ${totalChunksProcessed}`);
    console.log(`Successfully upserted chunks: ${successfullyUpsertedChunks}`);
    console.log(`Failed upsert batches: ${failedUpsertBatches}`);
    console.log(`Overall success: ${allUpsertsSucceeded ? 'Yes' : 'No'}`);

    // Verify data in Pinecone before final status update
    console.log(`[RAG Processor] Verifying data persistence in Pinecone for ${documentId}...`);
    try {
      // Check for the first chunk as verification
      const testVectorId = `${documentId}_chunk_1`;
      console.log(`[RAG Processor] Fetching test vector: ${testVectorId}`);
      const fetchResponse = await index.fetch([testVectorId]);
      
      // Defensive check for response structure
      const responseData = fetchResponse as unknown as { vectors?: Record<string, unknown> };
      const vectorExists = responseData?.vectors && testVectorId in responseData.vectors;
      
      if (vectorExists) {
        console.log(`[RAG Processor] ✅ Successfully verified vector in Pinecone: ${testVectorId}`);
      } else {
        console.warn(`[RAG Processor] ⚠️ Could not find test vector in Pinecone: ${testVectorId}`);
        allUpsertsSucceeded = false;
        firstErrorMessage = 'Failed to verify data persistence in Pinecone';
      }
    } catch (error) {
      const pineconeVerifyError = error as Error;
      console.error('[RAG Processor] ❌ Error verifying Pinecone data:', pineconeVerifyError);
      allUpsertsSucceeded = false;
      firstErrorMessage = `Pinecone verification failed: ${pineconeVerifyError.message}`;
    }

    // Prepare final status update with retries
    const finalStatus = allUpsertsSucceeded ? 'completed' : 'failed';
    const finalMessage = allUpsertsSucceeded 
      ? `Successfully processed all ${totalChunksProcessed} chunks`
      : `Partially failed: ${successfullyUpsertedChunks}/${totalChunksProcessed} chunks processed successfully. ${failedUpsertBatches} batch(es) failed. Error: ${firstErrorMessage || 'Unknown error'}`;

    console.log(`\n[RAG Processor] Attempting final '${finalStatus}' status update for ${documentId}...`);
    
    // Add retry logic for final status update
    const maxStatusUpdateRetries = 3;
    let statusUpdateRetryCount = 0;
    let statusUpdateSuccess = false;

    while (statusUpdateRetryCount < maxStatusUpdateRetries && !statusUpdateSuccess) {
      try {
        await updateFileRagStatus({
          id: documentId,
          processingStatus: finalStatus,
          statusMessage: finalMessage
        });
        console.log(`[RAG Processor] ✅ Successfully updated status to '${finalStatus}' for ${documentId} in DB.`);
        statusUpdateSuccess = true;
      } catch (dbUpdateError) {
        statusUpdateRetryCount++;
        console.error(`[RAG Processor] ❌ FAILED to update status to '${finalStatus}' for ${documentId} in DB (Attempt ${statusUpdateRetryCount}/${maxStatusUpdateRetries}):`, dbUpdateError);
        
        if (statusUpdateRetryCount < maxStatusUpdateRetries) {
          const retryDelay = 1000 * statusUpdateRetryCount; // Exponential backoff
          console.log(`[RAG Processor] Retrying status update after ${retryDelay}ms delay...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    if (!statusUpdateSuccess) {
      console.error(`[RAG Processor] ❌ All ${maxStatusUpdateRetries} attempts to update final status failed.`);
    }

    console.log(`[RAG Processor] === RAG processing completed (intended status: ${finalStatus}) for document ${documentId} ===\n`);

    return allUpsertsSucceeded;

  } catch (error) {
    console.error(`[RAG Processor] Processing failed:`, error);
    
    // Update status to failed with retries
    console.log(`[RAG Processor] Attempting final 'failed' status update for ${documentId}...`);
    const maxStatusUpdateRetries = 3;
    let statusUpdateRetryCount = 0;
    let statusUpdateSuccess = false;

    while (statusUpdateRetryCount < maxStatusUpdateRetries && !statusUpdateSuccess) {
      try {
        await updateFileRagStatus({
          id: documentId,
          processingStatus: 'failed',
          statusMessage: error instanceof Error ? error.message : 'Unknown error'
        });
        console.log(`[RAG Processor] ✅ Successfully updated status to 'failed' for ${documentId} in DB.`);
        statusUpdateSuccess = true;
      } catch (dbUpdateError) {
        statusUpdateRetryCount++;
        console.error(`[RAG Processor] ❌ FAILED to update status to 'failed' for ${documentId} in DB (Attempt ${statusUpdateRetryCount}/${maxStatusUpdateRetries}):`, dbUpdateError);
        
        if (statusUpdateRetryCount < maxStatusUpdateRetries) {
          const retryDelay = 1000 * statusUpdateRetryCount; // Exponential backoff
          console.log(`[RAG Processor] Retrying status update after ${retryDelay}ms delay...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    if (!statusUpdateSuccess) {
      console.error(`[RAG Processor] ❌ All ${maxStatusUpdateRetries} attempts to update final status failed.`);
    }
    
    return false;
  }
} 