import { getPineconeIndex } from './pinecone-client';
import { generateEmbeddings } from './ai/utils';
import { updateFileRagStatus, getDocumentById } from './db/queries';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

/**
 * Extracts text from a PDF buffer
 * @param buffer PDF file buffer
 * @returns Extracted text
 */
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    console.log('Extracting text from PDF...');
    console.log(`PDF buffer size: ${buffer.byteLength} bytes`);
    
    // Check if buffer is valid
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('Empty or invalid PDF buffer');
    }
    
    // Log first few bytes of buffer for debugging
    const bufferPreview = buffer.slice(0, Math.min(20, buffer.byteLength));
    console.log(`Buffer preview: ${bufferPreview.toString('hex')}`);
    
    // Check PDF header (should start with %PDF-)
    const header = buffer.slice(0, 5).toString();
    if (!header.startsWith('%PDF-')) {
      console.warn(`PDF header check failed. Found: ${header}`);
    }
    
    // Use minimal options for production reliability
    console.log('Calling pdfParse with buffer...');
    const result = await pdfParse(buffer);
    
    const extractedLength = result.text ? result.text.length : 0;
    console.log(`PDF extraction complete. Extracted ${extractedLength} characters.`);
    
    if (extractedLength === 0) {
      console.warn('PDF parsing succeeded but extracted 0 characters. This PDF may be image-based or have no text content.');
      return "This PDF appears to contain no extractable text. It may be image-based or scanned. Please upload a text-based PDF or use a different document format.";
    }
    
    return result.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`PDF extraction error details: ${errorMessage}`);
    
    // Return a fallback message when extraction fails
    return `This PDF could not be processed due to the following issue: ${errorMessage}. Please try uploading a different file or a text-based version of this document.`;
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
 * Downloads a file from a URL
 * @param url URL to download from
 * @returns Buffer containing the file data
 */
async function downloadFile(url: string): Promise<Buffer> {
  try {
    console.log(`Downloading file from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    console.log(`File download complete. Size: ${arrayBuffer.byteLength} bytes`);
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw new Error('Failed to download file');
  }
}

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
  console.log(`[RAG Processor ENTRY] Function called for document ${documentId}, fileUrl: ${fileUrl}`);
  
  try {
    console.log(`[RAG Processor TRY START] Starting main logic for document ${documentId}`);
    
    // Update status to processing first
    try {
      console.log(`[RAG Processor] Attempting to update status to 'processing' for document ID: ${documentId}`);
      await updateFileRagStatus({
        id: documentId,
        processingStatus: 'processing',
      });
      console.log(`[RAG Processor] Status updated to processing for ${documentId}`);
    } catch (statusError) {
      console.error(`❌ [RAG Processor] Error updating document status to 'processing':`, statusError);
      return false; // Stop further processing
    }
    
    // Get document details from database for source information
    let docDetails;
    try {
      console.log(`[RAG Processor] Attempting to fetch document details from DB for ID: ${documentId}`);
      docDetails = await getDocumentById({ id: documentId });
      console.log(`[RAG Processor] Fetched document details: ${docDetails ? 'Found' : 'Not Found'}`);
    } catch (dbError) {
      console.error(`❌ [RAG Processor] DB Error fetching document details for ID: ${documentId}`, dbError);
      // Update status to failed and exit
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'failed', 
        statusMessage: 'DB Error on fetch: ' + (dbError instanceof Error ? dbError.message : 'Unknown error') 
      });
      return false; // Stop further processing
    }

    if (!docDetails) {
      console.error(`❌ [RAG Processor] Document metadata not found in DB for ID: ${documentId}. Aborting processing.`);
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'failed', 
        statusMessage: 'Document metadata not found in database.' 
      });
      return false; // Stop further processing
    }
    
    const documentName = docDetails.fileName || 'Unknown document';
    console.log(`[RAG Processor] Document name set to: ${documentName}`);
    
    // Download the file
    console.log(`[RAG Processor] About to download file from URL: ${fileUrl}`);
    const fileBuffer = await downloadFile(fileUrl);
    console.log(`Downloaded file buffer size: ${fileBuffer.byteLength} bytes`);
    
    // Extract text based on file type
    let extractedText = '';
    if (fileType === 'application/pdf') {
      extractedText = await extractTextFromPDF(fileBuffer);
    } else if (fileType === 'text/plain') {
      extractedText = fileBuffer.toString('utf-8');
      console.log(`Text file parsed. Size: ${extractedText.length} characters`);
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      extractedText = await extractTextFromDOCX(fileBuffer);
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    
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
    const batchSize = 10;
    
    // Add tracking for partial failures
    let allUpsertsSucceeded = true;
    let firstErrorMessage = '';
    let totalChunksProcessed = 0;
    let successfullyUpsertedChunks = 0;
    let failedUpsertBatches = 0;

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      console.log(`[RAG Processor] Processing chunk ${i + 1}/${textChunks.length}. Ready to generate embedding.`);
      
      // Generate embeddings for the chunk - wrap in try/catch
      let embedding;
      try {
        console.time(`embedding_generation_chunk_${i}`);
        embedding = await generateEmbeddings(chunk);
        console.timeEnd(`embedding_generation_chunk_${i}`);
        console.log(`[RAG Processor] Embedding generated for chunk ${i + 1}. Dimensions: ${embedding?.length}`);
        totalChunksProcessed++;
      } catch (embeddingError) {
        console.error(`❌ [RAG Processor] Error generating embedding for chunk ${i + 1}:`, embeddingError);
        // Log details about the error
        if (embeddingError instanceof Error) {
          console.error(`Embedding Error Details: Name=${embeddingError.name}, Message=${embeddingError.message}`);
          console.error(`Stack trace: ${embeddingError.stack}`);
          
          // If this is the first error, store it
          if (!firstErrorMessage) {
            firstErrorMessage = `Embedding error: ${embeddingError.message}`;
          }
        }
        // Mark as overall failure
        allUpsertsSucceeded = false;
        totalChunksProcessed++;
        // Continue to the next chunk for now
        continue;
      }
      
      // Ensure embedding is valid before proceeding
      if (!embedding) {
        console.warn(`[RAG Processor] Skipping upsert for chunk ${i + 1} due to missing embedding.`);
        continue;
      }
      
      // Prepare the vector
      vectors.push({
        id: `${documentId}_chunk_${i}`,
        values: embedding,
        metadata: {
          documentId,
          userId,
          chunkIndex: i,
          text: chunk,
          source: documentName,
          timestamp: new Date().toISOString(),
        },
      });
      
      // Upload in batches to avoid rate limiting
      if (vectors.length >= batchSize || i === textChunks.length - 1) {
        const currentBatchSize = vectors.length;
        const indexNameToLog = process.env.PINECONE_INDEX_NAME || 'undefined_index';
        console.log(`Attempting to upsert batch of ${currentBatchSize} vectors to Pinecone index '${indexNameToLog}'...`);
        console.log(`Vector batch details: documentId=${documentId}, first vector ID=${vectors[0]?.id || 'unknown'}`);
        console.time('pinecone_upsert_batch');
        
        try {
          // Ensure the index object is valid before calling upsert
          if (!index || typeof index.upsert !== 'function') {
            throw new Error('Pinecone index object is invalid or upsert method not found.');
          }
          
          // Log first vector's dimension for verification
          if (vectors.length > 0 && vectors[0].values) {
            console.log(`First vector dimensions: ${vectors[0].values.length}`);
          }
          
          // Perform the upsert operation
          await index.upsert(vectors);
          
          console.timeEnd('pinecone_upsert_batch');
          console.log(`✅ Batch upsert successful for ${currentBatchSize} vectors to index '${indexNameToLog}'.`);
          
          // Verify upsert with a quick query (optional but helpful)
          if (vectors.length > 0) {
            try {
              console.time('pinecone_verify_upsert');
              const firstId = vectors[0].id;
              const describeStats = await index.describeIndexStats();
              console.log(`Index stats after upsert: totalRecordCount=${describeStats.totalRecordCount}, namespaces=${Object.keys(describeStats.namespaces || {}).length}`);
              console.timeEnd('pinecone_verify_upsert');
            } catch (verifyError) {
              console.warn(`Warning: Could not verify upsert with describeIndexStats:`, verifyError);
            }
          }
          
          successfullyUpsertedChunks += currentBatchSize;
        } catch (upsertError) {
          console.timeEnd('pinecone_upsert_batch');
          console.error(`❌ Pinecone batch upsert FAILED for index '${indexNameToLog}':`, upsertError);
          
          // Mark as overall failure
          allUpsertsSucceeded = false;
          failedUpsertBatches++;
          
          // Store first error message if not already set
          if (!firstErrorMessage && upsertError instanceof Error) {
            firstErrorMessage = `Upsert error: ${upsertError.message}`;
          }
          
          if (upsertError instanceof Error) {
            console.error(`Upsert Error Details: Name=${upsertError.name}, Message=${upsertError.message}`);
            console.error(`Stack trace: ${upsertError.stack}`);
          }
          
          // Check common environment issues
          console.log('Environment check:');
          console.log(`- PINECONE_API_KEY present: ${!!process.env.PINECONE_API_KEY}`);
          console.log(`- PINECONE_INDEX_NAME: ${process.env.PINECONE_INDEX_NAME}`);
          console.log(`- PINECONE_INDEX_HOST: ${process.env.PINECONE_INDEX_HOST}`);
          
          // Continue processing other chunks despite the error
          // Note: You could choose to stop by adding "throw upsertError;" here
          
          vectors.length = 0; // Clear the array regardless of success/fail
        }
      }
    }
    
    // Update status to completed or failed with detailed message
    console.log(`RAG processing stats: Processed ${totalChunksProcessed} chunks, successfully upserted ${successfullyUpsertedChunks} chunks, failed ${failedUpsertBatches} batches`);

    const finalStatus = allUpsertsSucceeded ? 'completed' : 'failed';
    const finalMessage = allUpsertsSucceeded 
      ? `Successfully processed all ${totalChunksProcessed} chunks`
      : `Partially failed: ${successfullyUpsertedChunks}/${totalChunksProcessed} chunks processed successfully. ${failedUpsertBatches} batch(es) failed. Error: ${firstErrorMessage || 'Unknown error'}`;

    // Update status
    await updateFileRagStatus({
      id: documentId,
      processingStatus: finalStatus,
      statusMessage: finalMessage
    });
    
    console.log(`Completed RAG processing for document ${documentId}`);
    return true;
  } catch (error) {
    console.error(`RAG processing failed for document ${documentId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Update status to failed with error message
    await updateFileRagStatus({
      id: documentId,
      processingStatus: 'failed',
      statusMessage: errorMessage
    });
    
    return false;
  }
} 