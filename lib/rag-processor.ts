import { getPineconeIndex } from './pinecone-client';
import { generateEmbeddings } from './ai/utils';
import { updateFileRagStatus, getDocumentById } from './db/queries';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { createWriteStream, createReadStream } from 'fs';
import { unlink, readFile } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { RecordMetadata, ScoredPineconeRecord } from '@pinecone-database/pinecone';

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
  try {
    // Update status to processing as the first step
    await updateFileRagStatus({
      id: documentId,
      processingStatus: 'processing',
      statusMessage: 'Starting document processing'
    });
    console.log(`[RAG Processor] Updated status to 'processing' for ${documentId}`);

    // Get document details
    docDetails = await getDocumentById({ id: documentId });
    if (!docDetails) {
      throw new Error('Document not found');
    }
    console.log(`[RAG Processor] Successfully fetched details for ID: ${documentId}. FileName: ${docDetails?.fileName}`);

    const { fileName: documentName, fileType: docType } = docDetails;

    // Download file using streaming
    console.log(`[RAG Processor] Starting streaming download for ${documentId}`);
    tempFilePath = await downloadFileStream(fileUrl);
    console.log(`[RAG Processor] File downloaded to temporary location: ${tempFilePath}`);

    // Extract text based on file type
    console.log(`[RAG Processor] Preparing to extract text (${fileType}) for ${documentId}`);
    let extractedText = '';

    if (fileType === 'application/pdf') {
      extractedText = await extractTextFromPDF(tempFilePath);
    } else if (fileType === 'text/plain' || fileType === 'text/markdown' || fileType === 'application/x-markdown') {
      extractedText = await new Promise((resolve, reject) => {
        let text = '';
        const readStream = createReadStream(tempFilePath!, { encoding: 'utf8' });
        readStream.on('data', chunk => { text += chunk; });
        readStream.on('end', () => resolve(text));
        readStream.on('error', reject);
      });
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    console.log(`[RAG Processor] Text extraction completed for ${documentId}. Length: ${extractedText?.length}`);

    // Skip if no meaningful text was extracted
    if (!extractedText || extractedText.trim().length === 0) {
      console.warn('No text extracted from document, or text is empty after trimming');
      throw new Error('No meaningful text extracted from document');
    }
    
    console.log(`Extracted ${extractedText.length} characters from document`);
    
    // Chunk the text
    const textChunks = chunkText(extractedText);
    console.log(`Split text into ${textChunks.length} chunks`);
    
    // Add pre-index log
    console.log('[RAG Processor] Attempting to get Pinecone index object...');
    
    // Get Pinecone index
    const index = getPineconeIndex();
    
    // Process chunks and upload to Pinecone
    const vectors = [];
    const batchSize = 5; // Reduced from 10 to 5 to avoid overwhelming the API
    const batchDelay = 1000; // 1 second delay between batches

    // Add tracking for partial failures
    let allUpsertsSucceeded = true;
    let firstErrorMessage = '';
    let totalChunksProcessed = 0;
    let successfullyUpsertedChunks = 0;
    let failedUpsertBatches = 0;

    // Before the loop starts, add overall timing
    console.time('total_rag_processing');
    console.log(`[RAG Processor] Starting to process ${textChunks.length} chunks in batches of ${batchSize}`);

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const chunkIndex = i + 1;
      console.log(`\n[RAG Processor] === Starting chunk ${chunkIndex}/${textChunks.length} ===`);
      console.log(`[RAG Processor] Current chunk size: ${chunk.length} characters`);
      console.time(`chunk_${chunkIndex}_total`);
      
      // Generate embeddings for the chunk - wrap in try/catch
      let embedding;
      try {
        console.log(`[RAG Processor] Generating embedding for chunk ${chunkIndex}/${textChunks.length} (${chunk.length} characters)`);
        console.time(`embedding_generation_chunk_${chunkIndex}`);
        embedding = await generateEmbeddings(chunk);
        console.timeEnd(`embedding_generation_chunk_${chunkIndex}`);
        console.log(`[RAG Processor] ✅ Embedding generated for chunk ${chunkIndex}. Dimensions: ${embedding?.length}`);
        totalChunksProcessed++;
      } catch (embeddingError) {
        console.timeEnd(`embedding_generation_chunk_${chunkIndex}`);
        console.error(`[RAG Processor] ❌ Error generating embedding for chunk ${chunkIndex}/${textChunks.length}:`, embeddingError);
        // Log details about the error
        if (embeddingError instanceof Error) {
          console.error(`[RAG Processor] Embedding Error Details for chunk ${chunkIndex}:
            Name: ${embeddingError.name}
            Message: ${embeddingError.message}
            Stack: ${embeddingError.stack}`);
          
          // If this is the first error, store it
          if (!firstErrorMessage) {
            firstErrorMessage = `Embedding error in chunk ${chunkIndex}: ${embeddingError.message}`;
          }
        }
        // Mark as overall failure
        allUpsertsSucceeded = false;
        totalChunksProcessed++;
        console.timeEnd(`chunk_${chunkIndex}_total`);
        console.log(`[RAG Processor] ❌ Chunk ${chunkIndex} failed at embedding generation`);
        console.log(`[RAG Processor] Continuing loop after embedding error for chunk ${chunkIndex}`);
        if (i + 1 < textChunks.length) {
          console.log(`[RAG Processor] Moving to process chunk ${i + 2}/${textChunks.length}`);
        }
        // Continue to the next chunk for now
        continue;
      }
      
      // Ensure embedding is valid before proceeding
      if (!embedding) {
        console.warn(`[RAG Processor] ⚠️ Skipping upsert for chunk ${chunkIndex} due to missing embedding.`);
        console.timeEnd(`chunk_${chunkIndex}_total`);
        if (i + 1 < textChunks.length) {
          console.log(`[RAG Processor] Moving to process chunk ${i + 2}/${textChunks.length}`);
        }
        continue;
      }
      
      // Prepare the vector
      console.log(`[RAG Processor] Preparing vector for chunk ${chunkIndex}`);
      vectors.push({
        id: `${documentId}_chunk_${chunkIndex}`,
        values: embedding,
        metadata: {
          documentId,
          userId,
          chunkIndex: i,
          text: chunk,
          source: documentName || 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`[RAG Processor] Vector prepared for chunk ${chunkIndex}. Current batch size: ${vectors.length}/${batchSize}`);
      
      // Upload in batches to avoid rate limiting
      if (vectors.length >= batchSize || i === textChunks.length - 1) {
        const currentBatchSize = vectors.length;
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(textChunks.length / batchSize);
        
        console.log(`\n[RAG Processor] === Processing batch ${batchNumber}/${totalBatches} ===`);
        console.log(`[RAG Processor] Preparing to upsert batch for chunks up to index ${i}. Batch size: ${vectors.length}`);
        console.time(`batch_${batchNumber}_total`);
        
        // Add a small delay between batches to avoid overwhelming the API
        if (i > 0 && vectors.length > 0) {
          console.log(`[RAG Processor] Adding delay of ${batchDelay}ms before processing batch ${batchNumber}...`);
          await new Promise(resolve => setTimeout(resolve, batchDelay));
          console.log(`[RAG Processor] Delay completed, proceeding with batch ${batchNumber}`);
        }
        
        const indexNameToLog = process.env.PINECONE_INDEX_NAME || 'undefined_index';
        console.log(`[RAG Processor] Attempting to upsert batch ${batchNumber}/${totalBatches} (${currentBatchSize} vectors) to Pinecone index '${indexNameToLog}'...`);
        console.time(`pinecone_upsert_batch_${batchNumber}`);
        
        // Add max retries for Pinecone upsert
        const maxUpsertRetries = 3;
        let upsertRetryCount = 0;
        let upsertSucceeded = false;
        
        while (upsertRetryCount < maxUpsertRetries && !upsertSucceeded) {
          try {
            // Ensure the index object is valid before calling upsert
            if (!index || typeof index.upsert !== 'function') {
              throw new Error('Pinecone index object is invalid or upsert method not found.');
            }
            
            // Log first vector's dimension for verification
            if (vectors.length > 0 && vectors[0].values) {
              console.log(`[RAG Processor] First vector in batch ${batchNumber} dimensions: ${vectors[0].values.length}`);
            }
            
            // Perform the upsert operation
            console.log(`[RAG Processor] Calling index.upsert now for batch ${batchNumber} (Attempt ${upsertRetryCount + 1}/${maxUpsertRetries})...`);
            await index.upsert(vectors);
            
            console.timeEnd(`pinecone_upsert_batch_${batchNumber}`);
            console.log(`[RAG Processor] ✅ Successfully upserted batch ${batchNumber} ending at chunk index ${i}`);
            upsertSucceeded = true;
            
            // Verify upsert with a quick query
            if (vectors.length > 0) {
              try {
                console.time(`pinecone_verify_batch_${batchNumber}`);
                const describeStats = await index.describeIndexStats();
                console.log(`[RAG Processor] Index stats after batch ${batchNumber}: totalRecordCount=${describeStats.totalRecordCount}`);
                console.timeEnd(`pinecone_verify_batch_${batchNumber}`);
              } catch (verifyError) {
                console.warn(`[RAG Processor] ⚠️ Could not verify batch ${batchNumber} upsert:`, verifyError);
              }
            }
            
            successfullyUpsertedChunks += currentBatchSize;
          } catch (upsertError) {
            upsertRetryCount++;
            
            console.timeEnd(`pinecone_upsert_batch_${batchNumber}`);
            console.error(`[RAG Processor] ❌ Batch ${batchNumber} upsert FAILED (Attempt ${upsertRetryCount}/${maxUpsertRetries}):`, upsertError);
            
            // Mark as overall failure
            allUpsertsSucceeded = false;
            
            // Store first error message if not already set
            if (!firstErrorMessage && upsertError instanceof Error) {
              firstErrorMessage = `Upsert error in batch ${batchNumber}: ${upsertError.message}`;
            }
            
            if (upsertError instanceof Error) {
              console.error(`[RAG Processor] Upsert Error Details for batch ${batchNumber}:
                Name: ${upsertError.name}
                Message: ${upsertError.message}
                Stack: ${upsertError.stack}`);
            }
            
            // Check common environment issues
            console.log('[RAG Processor] Environment check:');
            console.log(`- PINECONE_API_KEY present: ${!!process.env.PINECONE_API_KEY}`);
            console.log(`- PINECONE_INDEX_NAME: ${process.env.PINECONE_INDEX_NAME}`);
            console.log(`- PINECONE_INDEX_HOST: ${process.env.PINECONE_INDEX_HOST}`);
            
            // If not the last retry, add a delay before the next attempt
            if (upsertRetryCount < maxUpsertRetries) {
              const retryDelay = 1000 * upsertRetryCount; // Exponential backoff
              console.log(`[RAG Processor] Retrying batch ${batchNumber} after ${retryDelay}ms delay...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              console.log(`[RAG Processor] Retry delay completed for batch ${batchNumber}`);
            } else {
              // All retries failed
              failedUpsertBatches++;
              console.error(`[RAG Processor] ❌ All ${maxUpsertRetries} attempts to upsert batch ${batchNumber} failed.`);
            }
          }
        }
        
        console.timeEnd(`batch_${batchNumber}_total`);
        console.log(`[RAG Processor] === Completed batch ${batchNumber}/${totalBatches} ===\n`);
        vectors.length = 0; // Clear the array regardless of success/fail
        
        if (i + 1 < textChunks.length) {
          console.log(`[RAG Processor] Moving to process chunk ${i + 2}/${textChunks.length}`);
        }
      }
      
      console.timeEnd(`chunk_${chunkIndex}_total`);
      console.log(`[RAG Processor] === Completed chunk ${chunkIndex}/${textChunks.length} ===\n`);
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

    // Clean up temporary file
    if (tempFilePath) {
      try {
        await unlinkAsync(tempFilePath);
        console.log(`[RAG Processor] Temporary file cleaned up: ${tempFilePath}`);
      } catch (cleanupError) {
        console.warn(`[RAG Processor] Failed to clean up temporary file: ${cleanupError}`);
      }
    }

    return true;
  } catch (error) {
    console.error(`[RAG Processor] Processing failed:`, error);
    
    // Clean up temporary file in case of error
    if (tempFilePath) {
      try {
        await unlinkAsync(tempFilePath);
        console.log(`[RAG Processor] Cleaned up temporary file after error: ${tempFilePath}`);
      } catch (cleanupError) {
        console.warn(`[RAG Processor] Failed to clean up temporary file: ${cleanupError}`);
      }
    }
    
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