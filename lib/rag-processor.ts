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
  try {
    console.log(`Starting RAG processing for document ${documentId}`);
    
    // Update status to processing
    await updateFileRagStatus({
      id: documentId,
      processingStatus: 'processing',
    });
    
    // Get document details from database for source information
    const docDetails = await getDocumentById({ id: documentId });
    const documentName = docDetails?.fileName || 'Unknown document';
    
    // Download the file
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
    
    // Get Pinecone index
    const index = getPineconeIndex();
    
    // Process chunks and upload to Pinecone
    const vectors = [];
    const batchSize = 10;
    
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      console.log(`Processing chunk ${i + 1}/${textChunks.length}, size: ${chunk.length} characters`);
      
      // Generate embeddings for the chunk
      const embedding = await generateEmbeddings(chunk);
      
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
        console.log(`Upserting batch of ${vectors.length} vectors to Pinecone`);
        await index.upsert(vectors);
        console.log('Upsert complete');
        vectors.length = 0; // Clear the array
      }
    }
    
    // Update status to completed
    await updateFileRagStatus({
      id: documentId,
      processingStatus: 'completed',
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