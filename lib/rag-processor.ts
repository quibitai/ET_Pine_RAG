import { getPineconeIndex } from './pinecone-client';
import { generateEmbeddings } from './ai/utils';
import { updateFileRagStatus, getDocumentById } from './db/queries';
import { createWriteStream, createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { PineconeRecord, RecordMetadata } from '@pinecone-database/pinecone';

const unlinkAsync = promisify(unlink);

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
 * Downloads a file from a URL using streaming to avoid memory issues
 * @param url URL to download from
 * @returns Path to the temporary file
 */
async function downloadFileStream(url: string): Promise<string> {
  console.log(`[downloadFile ENTRY] Function called for URL: ${url.split('?')[0]}`);
  
  try {
    // Create a temporary file path
    const tempFilePath = join(tmpdir(), `${randomUUID()}-download`);
    console.log(`[downloadFile] Created temp file: ${tempFilePath}`);
    
    // Fetch the file
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    // Create write stream to temporary file
    const fileStream = createWriteStream(tempFilePath);
    
    // Create a Node.js readable stream from the response body
    const reader = response.body.getReader();
    const nodeReadable = new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null);
          } else {
            this.push(Buffer.from(value));
          }
        } catch (error) {
          this.destroy(error as Error);
        }
      }
    });
    
    // Stream the download to the temporary file
    console.log('[downloadFile] Starting streaming download...');
    await pipeline(nodeReadable, fileStream);
    console.log('[downloadFile] Download stream completed successfully');
    
    return tempFilePath;
  } catch (error) {
    console.error('[downloadFile] Error during streaming download:', error);
    throw error;
  }
}

/**
 * Extracts text from a PDF file using its file path
 * @param filePath Path to the PDF file
 * @returns Extracted text
 */
async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    console.log(`[extractTextFromPDF] Starting PDF text extraction from path: ${filePath}`);
    
    // Read file as buffer (pdf-parse requires Buffer input)
    const dataBuffer = await readFile(filePath);
    console.log(`[extractTextFromPDF] File read into buffer. Size: ${dataBuffer.length} bytes`);
    
    // Parse PDF
    const result = await pdfParse(dataBuffer);
    
    const extractedLength = result.text ? result.text.length : 0;
    console.log(`[extractTextFromPDF] Extraction complete. Extracted ${extractedLength} characters.`);
    
    if (extractedLength === 0) {
      console.warn('[extractTextFromPDF] PDF parsing succeeded but extracted 0 characters.');
      return "This PDF appears to contain no extractable text. It may be image-based or scanned.";
    }
    
    return result.text;
  } catch (error) {
    console.error('[extractTextFromPDF] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // Re-throw the error so the main catch block in processFileForRag handles the status update
    throw new Error(`PDF processing error: ${errorMessage}`); 
  }
}

/**
 * Extracts text from a DOCX buffer
 * @param buffer DOCX file buffer
 * @returns Extracted text
 */
async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  try {
    console.log('Extracting text from DOCX...');
    
    const result = await mammoth.extractRawText({ buffer });
    
    console.log(`DOCX extraction complete. Extracted ${result.value.length} characters.`);
    return result.value;
  } catch (error) {
    console.error('Error extracting text from DOCX:', error);
    
    // Return a fallback message when extraction fails
    return "This DOCX file could not be processed due to formatting issues. Please try uploading a different file or a text-based version of this document.";
  }
}

// --- NEW: Interface for Unstructured API Response ---
interface UnstructuredElement {
  type: string;
  text: string;
  metadata: {
    filename?: string;
    page_number?: number;
  };
}

// --- NEW: Function to call Unstructured API ---
async function extractTextWithUnstructured(
  fileUrl: string,
  apiKey: string
): Promise<{ elements: UnstructuredElement[]; fullText: string }> {
  console.log(`[Unstructured] Starting extraction for URL: ${fileUrl.split('?')[0]}`);
  const apiUrl = "https://api.unstructured.io/general/v0/general";

  const requestData = {
    url: fileUrl,
    strategy: "auto",
    pdf_infer_table_structure: "true",
  };

  try {
    console.time('unstructured_api_call');
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "Content-Type": "application/json",
        "unstructured-api-key": apiKey,
      },
      body: JSON.stringify(requestData),
    });
    console.timeEnd('unstructured_api_call');

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

  } catch (error) {
    console.error("[Unstructured] Failed to process document:", error);
    throw error;
  }
}

/**
 * Processes a document for RAG
 * @param documentId ID of the document to process
 * @param fileUrl URL of the file to download
 * @param fileType MIME type of the file
 * @param userId ID of the user who uploaded the file
 */
export async function processFileForRag({
  documentId,
  fileUrl,
  fileType,
  userId,
}: {
  documentId: string;
  fileUrl: string;
  fileType: string;
  userId: string;
}): Promise<boolean> {
  console.time('total_rag_processing');
  console.log(`[RAG Processor] Starting RAG processing for document ${documentId}`);
  
  let docDetails;
  let tempFilePath: string | null = null;
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

    const { fileName: documentName, fileType: docType } = docDetails;

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

    // Get file URL
    const fileUrlToUse = fileUrl || docDetails.fileUrl;
    if (!fileUrlToUse) {
      throw new Error('Document has no associated file URL');
    }

    // Extract text using Unstructured API
    console.log(`[RAG Processor] Sending URL to Unstructured API for ${documentId}`);
    const { elements, fullText } = await extractTextWithUnstructured(fileUrlToUse, unstructuredApiKey);
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