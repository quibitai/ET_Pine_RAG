import { getPineconeIndex } from './pinecone-client';
import { generateEmbeddings } from './ai/utils';
import { updateFileRagStatus, getDocumentById } from './db/queries';
import { randomUUID } from 'crypto';
import type { PineconeRecord, RecordMetadata } from '@pinecone-database/pinecone';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

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

/**
 * Extracts text from a document using Google Cloud Document AI
 * @param fileUrl URL of the file to process
 * @param fileType MIME type of the file
 * @returns Object containing extracted full text
 */
async function extractTextWithGoogleDocumentAI(
  fileUrl: string,
  fileType: string
): Promise<{ fullText: string }> {
  console.log(`[Document AI] Starting extraction for URL: ${fileUrl.split('?')[0]}`);
  
  try {
    // Verify required environment variables
    const projectId = process.env.DOCUMENT_AI_PROJECT_ID;
    const location = process.env.DOCUMENT_AI_LOCATION;
    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
    
    if (!projectId || !location || !processorId) {
      throw new Error('Missing required Document AI environment variables. Check DOCUMENT_AI_PROJECT_ID, DOCUMENT_AI_LOCATION, and DOCUMENT_AI_PROCESSOR_ID');
    }
    
    // Initialize the Document AI client
    const client = new DocumentProcessorServiceClient();
    
    // Download the file content from URL
    console.log('[Document AI] Downloading file from URL...');
    console.time('documentai_download');
    const fileResponse = await fetch(fileUrl);
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status} ${fileResponse.statusText}`);
    }
    
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    console.timeEnd('documentai_download');
    console.log(`[Document AI] Downloaded file size: ${fileBuffer.length} bytes`);
    
    // Encode file to base64
    const encodedFile = fileBuffer.toString('base64');
    
    // Construct the processor name
    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
    console.log(`[Document AI] Using processor: ${name}`);
    
    // Prepare request for Document AI
    const request = {
      name,
      rawDocument: {
        content: encodedFile,
        mimeType: fileType,
      },
    };
    
    // Process document
    console.log('[Document AI] Sending document for processing...');
    console.time('documentai_process');
    const [result] = await client.processDocument(request);
    console.timeEnd('documentai_process');
    
    // Extract text from document
    const document = result.document;
    // Explicitly handle the possibility of null or undefined with type assertion
    const fullText = document && document.text ? String(document.text) : '';
    
    if (!fullText || fullText.trim().length === 0) {
      throw new Error('No text extracted from document by Document AI');
    }
    
    console.log(`[Document AI] Successfully extracted text. Length: ${fullText.length} characters`);
    
    return { fullText };
  } catch (error) {
    console.error('[Document AI] Error processing document:', error);
    
    // Provide detailed error information
    if (error instanceof Error) {
      console.error('[Document AI] Error name:', error.name);
      console.error('[Document AI] Error message:', error.message);
      console.error('[Document AI] Error stack:', error.stack);
      
      // Create a more descriptive error
      const enhancedError = new Error(`Document AI error: ${error.message}`);
      enhancedError.stack = error.stack;
      throw enhancedError;
    }
    
    throw error;
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
    // Validate Document AI environment variables
    const projectId = process.env.DOCUMENT_AI_PROJECT_ID;
    const location = process.env.DOCUMENT_AI_LOCATION;
    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
    
    if (!projectId || !location || !processorId) {
      throw new Error('Document AI environment variables not set. Check DOCUMENT_AI_PROJECT_ID, DOCUMENT_AI_LOCATION, and DOCUMENT_AI_PROCESSOR_ID');
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

    // Extract text using Google Cloud Document AI
    console.log(`[RAG Processor] Sending URL to Google Cloud Document AI for ${documentId}`);
    const { fullText } = await extractTextWithGoogleDocumentAI(fileUrl, fileType);
    console.log(`[RAG Processor] Text extraction via Google Cloud Document AI completed for ${documentId}`);

    // Process text chunks
    console.log("[RAG Processor] Using local chunkText function.");
    if (!fullText || fullText.trim().length === 0) {
      throw new Error('No meaningful text extracted from document via Google Cloud Document AI.');
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