import { getPineconeIndex } from './pinecone-client';
import { updateFileRagStatus, getDocumentById } from './db/queries';
import type { PineconeRecord, RecordMetadata } from '@pinecone-database/pinecone';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { del } from '@vercel/blob';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import mammoth from 'mammoth';
import { generateEmbeddings } from './ai/utils';
import { Client as QStashClient } from '@upstash/qstash';

// Environment variables
const GOOGLE_CREDENTIALS_JSON_CONTENT = process.env.GOOGLE_CREDENTIALS_JSON;

// Parse credentials first to potentially extract project ID
let credentialsProjectId = '';
try {
  if (GOOGLE_CREDENTIALS_JSON_CONTENT) {
    const parsedCredentials = JSON.parse(GOOGLE_CREDENTIALS_JSON_CONTENT);
    credentialsProjectId = parsedCredentials.project_id || '';
    console.log(`Extracted project_id from credentials: "${credentialsProjectId}"`);
  }
} catch (e) {
  console.error("Failed to parse GOOGLE_CREDENTIALS_JSON to extract project_id:", e);
}

// Ensure worker URL has proper protocol
function ensureCompleteUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

// Environment variables with fallbacks
const PROJECT_ID = process.env.GOOGLE_PROJECT_ID || credentialsProjectId || '';
const LOCATION = process.env.DOCUMENT_AI_LOCATION || 'us'; // e.g., 'us'
const PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || '';

// Try multiple ways to get the API key
// First, try to get from process.env directly
let apiKeyFromEnv = process.env.GOOGLE_API_KEY;
console.log("API key directly from process.env:", apiKeyFromEnv ? `${apiKeyFromEnv.substring(0, 4)}...` : "NOT SET");

// Log all environment variables (masked for security)
console.log("All environment variables (first 4 chars only):");
for (const key in process.env) {
  if (key.includes("KEY") || key.includes("SECRET") || key.includes("TOKEN")) {
    const value = process.env[key];
    console.log(`${key}: ${value ? value.substring(0, 4) + "..." : "NOT SET"}`);
  } else if (key.includes("GOOGLE")) {
    const value = process.env[key];
    console.log(`${key}: ${value || "NOT SET"}`);
  }
}

// Try alternative casing (sometimes environment variables can be case-sensitive)
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.google_api_key || '';
if (!GOOGLE_API_KEY) {
  console.error("❌ CRITICAL: GOOGLE_API_KEY environment variable is not set in any casing!");
} else {
  console.log(`✅ GOOGLE_API_KEY is set (${GOOGLE_API_KEY.substring(0, 4)}...${GOOGLE_API_KEY.substring(GOOGLE_API_KEY.length - 4)})`);
}
const QSTASH_TOKEN = process.env.QSTASH_TOKEN || '';
// Process worker URL to ensure it has https:// prefix
const rawWorkerUrl = process.env.QSTASH_WORKER_URL || 'example.vercel.app/api/rag-worker';
const WORKER_URL = ensureCompleteUrl(rawWorkerUrl);
console.log(`Using QStash worker URL: ${WORKER_URL}`);

// Initialize the Document AI client with explicit credentials
let documentClient: DocumentProcessorServiceClient;

if (!GOOGLE_CREDENTIALS_JSON_CONTENT) {
  console.error("❌ CRITICAL: GOOGLE_CREDENTIALS_JSON environment variable is not set!");
  // Throw an error immediately if credentials are required and missing
  throw new Error("Server configuration error: Google Cloud credentials are missing.");
} else {
  try {
    // Parse the JSON content to ensure it's valid
    const credentials = JSON.parse(GOOGLE_CREDENTIALS_JSON_CONTENT);
    
    // Initialize client WITH credentials
    documentClient = new DocumentProcessorServiceClient({
      projectId: PROJECT_ID,
      credentials,
    });
    console.log("✅ Document AI client initialized successfully using credentials from GOOGLE_CREDENTIALS_JSON.");
  } catch (parseError) {
    console.error("❌ CRITICAL: Failed to parse GOOGLE_CREDENTIALS_JSON content:", parseError);
    console.error("Ensure the environment variable contains valid, unescaped JSON.");
    // Throw error if parsing fails, as auth will not work
    throw new Error("Server configuration error: Could not parse Google Cloud credentials JSON.");
  }
}

// Initialize QStash client
const qstashClient = new QStashClient({
  token: QSTASH_TOKEN
});

/**
 * Determines the MIME type from a file name or extension
 * @param {string} fileName - The name of the file
 * @returns {string} The MIME type
 */
function getMimeTypeFromFileName(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  
  const mimeTypeMap: Record<string, string> = {
    // Document formats
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'rtf': 'application/rtf',
    'txt': 'text/plain',
    
    // Spreadsheet formats
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'csv': 'text/csv',
    
    // Presentation formats
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    
    // Default to PDF if unknown
    '': 'application/pdf'
  };
  
  return mimeTypeMap[extension] || 'application/pdf';
}

/**
 * Checks if a file is a PDF based on its MIME type
 * @param {string} mimeType - The MIME type
 * @returns {boolean} True if the file is a PDF
 */
function isPdf(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

/**
 * Prepares document for processing based on file type.
 * Different file types might need different handling for Document AI.
 * @param {Uint8Array} fileBytes - Original file bytes
 * @param {string} mimeType - Original MIME type
 * @param {string} fileName - Original file name
 * @returns {Promise<{fileBytes: Uint8Array, mimeType: string}>} - Processed file bytes and MIME type
 */
async function prepareDocumentForProcessing(
  fileBytes: Uint8Array,
  mimeType: string,
  fileName: string
): Promise<{fileBytes: Uint8Array, mimeType: string}> {
  // The Document AI processor should handle the actual MIME type
  console.log(`[RAG Processor] Processing document with native MIME type: ${mimeType}`);
  
  return {
    fileBytes,
    mimeType
  };
}

/**
 * Extracts text from a document using Google Document AI.
 * @param {Uint8Array} fileBytes - The binary content of the file.
 * @param {string} fileName - The name of the file for MIME type detection.
 * @returns {Promise<string>} The extracted text.
 */
export async function extractTextWithGoogleDocumentAI(
  fileBytes: Uint8Array, 
  fileName: string = ''
): Promise<string> {
  try {
    console.log(`[RAG Processor] Starting Google Document AI text extraction for ${fileName || 'document'}`);
    const processorName = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;
    
    // Determine MIME type from file name
    const originalMimeType = getMimeTypeFromFileName(fileName);
    console.log(`[RAG Processor] Detected MIME type: ${originalMimeType} for file: ${fileName}`);
    
    // Add detailed debugging
    console.log('[RAG Processor] Document AI Configuration:');
    console.log(`[RAG Processor] - Project ID: "${PROJECT_ID}"`);
    console.log(`[RAG Processor] - Location: "${LOCATION}"`);
    console.log(`[RAG Processor] - Processor ID: "${PROCESSOR_ID}"`);
    console.log(`[RAG Processor] - Full Processor Name: "${processorName}"`);
    
    // Check for empty values
    if (!PROJECT_ID) console.error('[RAG Processor] ERROR: PROJECT_ID is empty!');
    if (!LOCATION) console.error('[RAG Processor] ERROR: LOCATION is empty!');
    if (!PROCESSOR_ID) console.error('[RAG Processor] ERROR: PROCESSOR_ID is empty!');
    
    // Print service account project ID for comparison
    try {
      const credentials = JSON.parse(GOOGLE_CREDENTIALS_JSON_CONTENT || '{}');
      console.log(`[RAG Processor] - Service Account Project ID: "${credentials.project_id}"`);
      if (credentials.project_id !== PROJECT_ID) {
        console.error(`[RAG Processor] ERROR: Service account project ID "${credentials.project_id}" doesn't match GOOGLE_PROJECT_ID "${PROJECT_ID}"!`);
      }
    } catch (e) {
      console.error('[RAG Processor] ERROR: Could not parse credentials JSON to compare project IDs');
    }
    
    // Log document file info
    console.log(`[RAG Processor] - Document size: ${fileBytes?.length || 0} bytes`);
    console.log(`[RAG Processor] - Format: ${originalMimeType}`);
    
    // Process the document - prepare document for processing
    const { fileBytes: processedBytes, mimeType: processedMimeType } = 
      await prepareDocumentForProcessing(fileBytes, originalMimeType, fileName);
    
    console.log(`[RAG Processor] Calling Document AI API with processor name: ${processorName}`);
    
    // For PDFs, add special handling for large documents with imageless mode
    if (isPdf(processedMimeType)) {
      console.log(`[RAG Processor] Explicitly enabling imageless mode for PDF to support up to 30 pages`);
    }
    
    try {
      // Explicitly format the request according to the Google Cloud API documentation
      // https://cloud.google.com/document-ai/docs/process-documents-client-libraries
      const request = {
        name: processorName,
        rawDocument: {
          content: processedBytes,
          mimeType: processedMimeType,
        },
        skipHumanReview: true,  // Add this parameter
      };
      
      // Add special processing options for PDFs only
      if (isPdf(processedMimeType)) {
        // @ts-ignore - Add imageless mode directly to bypass type issues
        request.processOptions = {
          ocrConfig: {
            enableImageless: true,
          },
        };
      }
      
      console.log(`[RAG Processor] Request configured with MIME type ${processedMimeType}:`, 
                 JSON.stringify({
                   ...request, 
                   rawDocument: { ...request.rawDocument, content: `[${processedBytes.length} bytes]` }
                 }, null, 2));
      
      const [result] = await documentClient.processDocument(request);
      
      const document = result.document;
      if (!document || !document.text) {
        throw new Error('No text extracted from document');
      }
      
      console.log(`[RAG Processor] Text extraction successful, extracted ${document.text.length} characters`);
      return document.text;
    } catch (error) {
      console.error('[RAG Processor] Error extracting text with Google Document AI:', error);
      if (error instanceof Error && (error.message.includes('Could not load the default credentials') || 
                                   error.message.includes('permission denied') || 
                                   error.message.includes('invalid_grant'))) {
        console.error("Authentication/Permission Error Detail: Verify GOOGLE_CREDENTIALS_JSON variable content and service account permissions in GCP console.");
      }
      
      // Enhanced error diagnostics
      if (error instanceof Error && error.message.includes('INVALID_ARGUMENT')) {
        console.error('[RAG Processor] INVALID_ARGUMENT error detected. This usually means:');
        console.error('1. The processor ID does not exist in this project');
        console.error('2. The location is incorrect (should be "us" based on your processor)');
        console.error('3. The project ID in environment variable does not match the service account project');
        console.error(`Current configuration: Project=${PROJECT_ID}, Location=${LOCATION}, ProcessorID=${PROCESSOR_ID}`);
        
        // Suggest the correct format based on screenshots
        console.error(`[RAG Processor] Try using this exact processor string: projects/openwebui-451318/locations/us/processors/5df939cb6b4e3bd4`);
      }
      
      throw error;
    }
  } catch (error) {
    console.error('[RAG Processor] Error extracting text with Google Document AI:', error);
    if (error instanceof Error && (error.message.includes('Could not load the default credentials') || 
                                 error.message.includes('permission denied') || 
                                 error.message.includes('invalid_grant'))) {
      console.error("Authentication/Permission Error Detail: Verify GOOGLE_CREDENTIALS_JSON variable content and service account permissions in GCP console.");
    }
    
    // Enhanced error diagnostics
    if (error instanceof Error && error.message.includes('INVALID_ARGUMENT')) {
      console.error('[RAG Processor] INVALID_ARGUMENT error detected. This usually means:');
      console.error('1. The processor ID does not exist in this project');
      console.error('2. The location is incorrect (should be "us" based on your processor)');
      console.error('3. The project ID in environment variable does not match the service account project');
      console.error(`Current configuration: Project=${PROJECT_ID}, Location=${LOCATION}, ProcessorID=${PROCESSOR_ID}`);
      
      // Suggest the correct format based on screenshots
      console.error(`[RAG Processor] Try using this exact processor string: projects/openwebui-451318/locations/us/processors/5df939cb6b4e3bd4`);
    }
    
    throw error;
  }
}

/**
 * Splits a text into chunks of roughly equal size with some overlap.
 * @param {string} text - The text to split.
 * @param {number} chunkSize - The target size of each chunk.
 * @param {number} overlap - The number of characters to overlap between chunks.
 * @returns {string[]} An array of text chunks.
 */
export function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  console.log(`[RAG Processor] Chunking text (length: ${text.length}) into chunks of size ${chunkSize} with ${overlap} overlap`);
  
  if (!text || text.trim() === '') {
    console.warn('[RAG Processor] Empty text provided for chunking');
    return [];
  }
  
  const chunks: string[] = [];
  let startIndex = 0;
  
  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize;
    
    // If this isn't the end of the text, try to find a natural break point
    if (endIndex < text.length) {
      // Look for natural break points in the last part of the chunk
      const searchArea = text.substring(endIndex - Math.min(200, chunkSize/4), endIndex);
      const periods = [...searchArea.matchAll(/\./g)];
      const paragraphs = [...searchArea.matchAll(/\n\s*\n/g)];
      
      // Prioritize paragraph breaks, then periods
      if (paragraphs.length > 0) {
        const lastParagraph = paragraphs[paragraphs.length - 1];
        endIndex = endIndex - (searchArea.length - lastParagraph.index);
      } else if (periods.length > 0) {
        const lastPeriod = periods[periods.length - 1];
        endIndex = endIndex - (searchArea.length - lastPeriod.index) + 1; // +1 to include the period
      }
    }
    
    // Extract the chunk and add it to our list
    const chunk = text.substring(startIndex, endIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    
    // Move to the next chunk, accounting for overlap
    startIndex = endIndex - overlap;
    
    // Safety check to prevent infinite loops
    if (startIndex >= text.length || startIndex === 0) {
      break;
    }
  }
  
  console.log(`[RAG Processor] Created ${chunks.length} chunks from text`);
  return chunks;
}

/**
 * Process a document for RAG
 * @param documentId ID of the document to process
 * @param userId ID of the user who uploaded the document
 * @param fileExtension Optional file extension override
 */
export async function processFileForRag({ 
  documentId, 
  userId, 
  fileExtension 
}: { 
  documentId: string; 
  userId: string;
  fileExtension?: string;
}) {
  console.log(`[RAG Processor] Starting RAG processing for document ${documentId} for user ${userId}`);
  
  try {
    // Get document details from database
    const docDetails = await getDocumentById({ id: documentId });
    if (!docDetails) {
      throw new Error(`Document ${documentId} not found in database`);
    }
    
    // Update document status to processing
    await updateFileRagStatus({ 
      id: documentId, 
      processingStatus: 'processing', 
      statusMessage: 'Document download in progress' 
    });
    
    // Download the document from Vercel Blob
    console.log(`[RAG Processor] Downloading document from ${docDetails.blobUrl}`);
    const documentResponse = await fetch(docDetails.blobUrl);
    if (!documentResponse.ok) {
      throw new Error(`Failed to download document from Blob storage: ${documentResponse.statusText}`);
    }
    
    // Convert to Uint8Array and Buffer for various processing options
    const fileBuffer = await documentResponse.arrayBuffer();
    const fileBytes = new Uint8Array(fileBuffer);
    const nodeBuffer = Buffer.from(fileBuffer);
    
    // Update status - starting text extraction
    await updateFileRagStatus({ 
      id: documentId, 
      processingStatus: 'processing', 
      statusMessage: 'Extracting text from document' 
    });

    // Determine file type from MIME type and extension
    const extractedFileExtension = docDetails.fileName.split('.').pop()?.toLowerCase() || '';
    const effectiveFileExtension = fileExtension || extractedFileExtension;
    const mimeType = docDetails.fileType.toLowerCase();

    console.log(`[RAG Processor] Attempting extraction for type: ${mimeType}, extension: ${effectiveFileExtension}`);

    // --- Conditional Extraction Logic ---
    let extractedText = '';

    if (mimeType === 'application/pdf') {
      console.log('[RAG Processor] Using Google Document AI for PDF...');
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'processing', 
        statusMessage: 'Extracting text using Document AI' 
      });
      extractedText = await extractTextWithGoogleDocumentAI(fileBytes, docDetails.fileName);
    } else if (mimeType === 'text/plain' || effectiveFileExtension === 'txt') {
      console.log('[RAG Processor] Reading plain text file...');
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'processing', 
        statusMessage: 'Reading plain text' 
      });
      extractedText = nodeBuffer.toString('utf-8');
    } else if (mimeType === 'text/markdown' || effectiveFileExtension === 'md') {
      console.log('[RAG Processor] Reading markdown file as plain text...');
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'processing', 
        statusMessage: 'Reading markdown file' 
      });
      // Basic extraction - just treat as text. Advanced parsing could strip markdown syntax if needed.
      extractedText = nodeBuffer.toString('utf-8');
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || effectiveFileExtension === 'docx') {
      console.log('[RAG Processor] Extracting text from DOCX using mammoth...');
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'processing', 
        statusMessage: 'Extracting text from DOCX' 
      });
      try {
        const result = await mammoth.extractRawText({ buffer: nodeBuffer });
        extractedText = result.value;
      } catch (docxError) {
        console.error('[RAG Processor] Error extracting DOCX:', docxError);
        throw new Error(`Failed to extract text from DOCX: ${docxError instanceof Error ? docxError.message : String(docxError)}`);
      }
    } else if (mimeType === 'text/csv' || effectiveFileExtension === 'csv') {
      console.log('[RAG Processor] Extracting text from CSV using papaparse...');
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'processing', 
        statusMessage: 'Extracting text from CSV' 
      });
      try {
        const csvString = nodeBuffer.toString('utf-8');
        const result = Papa.parse(csvString, { header: true, skipEmptyLines: true });
        if (result.errors && result.errors.length > 0) {
          console.warn('[RAG Processor] CSV parsing errors encountered:', result.errors);
        }
        // Convert parsed data to a simple textual representation for RAG
        extractedText = result.data.map((row: any, index: number) => {
          return `Row ${index + 1}: ${Object.entries(row).map(([key, value]) => `${key} is "${value}"`).join(', ')}`;
        }).join('\n');
      } catch (csvError) {
        console.error('[RAG Processor] Error extracting CSV:', csvError);
        throw new Error(`Failed to extract text from CSV: ${csvError instanceof Error ? csvError.message : String(csvError)}`);
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || effectiveFileExtension === 'xlsx') {
      console.log('[RAG Processor] Extracting text from XLSX using SheetJS...');
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'processing', 
        statusMessage: 'Extracting text from XLSX' 
      });
      try {
        const workbook = XLSX.read(nodeBuffer, { type: 'buffer' });
        let combinedText = '';
        workbook.SheetNames.forEach(sheetName => {
          combinedText += `Sheet: ${sheetName}\n`;
          const worksheet = workbook.Sheets[sheetName];
          const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 }); // Get array of arrays
          jsonData.forEach((row: any[], rowIndex: number) => {
            combinedText += `Row ${rowIndex + 1}: ${row.map((cell: any, colIndex: number) => `Column ${colIndex + 1} is "${cell}"`).join(', ')}\n`;
          });
          combinedText += '\n';
        });
        extractedText = combinedText.trim();
      } catch (xlsxError) {
        console.error('[RAG Processor] Error extracting XLSX:', xlsxError);
        throw new Error(`Failed to extract text from XLSX: ${xlsxError instanceof Error ? xlsxError.message : String(xlsxError)}`);
      }
    } else {
      // Fallback - try Document AI as a last resort
      console.warn(`[RAG Processor] Unsupported file type: ${mimeType} / ${effectiveFileExtension}. Trying Document AI as fallback.`);
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'processing', 
        statusMessage: `Attempting extraction with Document AI` 
      });
      try {
        extractedText = await extractTextWithGoogleDocumentAI(fileBytes, docDetails.fileName);
      } catch (fallbackError) {
        console.error('[RAG Processor] Fallback extraction failed:', fallbackError);
        await updateFileRagStatus({ 
          id: documentId, 
          processingStatus: 'failed', 
          statusMessage: `Unsupported file type: ${mimeType}` 
        });
        throw new Error(`Unsupported file type for RAG processing: ${mimeType}`);
      }
    }

    // Ensure extractedText is not empty before proceeding
    if (!extractedText || extractedText.trim().length === 0) {
      await updateFileRagStatus({ 
        id: documentId, 
        processingStatus: 'failed', 
        statusMessage: 'No text content extracted from the document.' 
      });
      throw new Error('No text extracted from document');
    }

    console.log(`[RAG Processor] Extracted ${extractedText.length} characters.`);
    
    // Chunk the text
    const textChunks = chunkText(extractedText);
    if (textChunks.length === 0) {
      throw new Error('Failed to create chunks from extracted text');
    }
    
    // Update status with total chunks
    const totalChunks = textChunks.length;
    await updateFileRagStatus({ 
      id: documentId, 
      processingStatus: 'processing', 
      statusMessage: `Text extracted and chunked into ${totalChunks} segments. Queueing embedding jobs.`,
      totalChunks
    });
    
    // Queue chunk processing jobs
    console.log(`[RAG Processor] Queueing ${totalChunks} embedding jobs for document ${documentId}`);
    console.log(`[RAG Processor] Using worker URL: ${WORKER_URL}`);
    
    await Promise.all(textChunks.map(async (chunkText, chunkIndex) => {
      try {
        console.log(`[RAG Processor] Enqueuing job for chunk ${chunkIndex+1}/${totalChunks} of document ${documentId}`);
        
        // Create the payload for this chunk
        const payload = {
          documentId,
          userId,
          chunkIndex,
          chunkText,
          totalChunks,
          documentName: docDetails.fileName
        };
        
        // Send to QStash with validated URL
        console.log(`[RAG Processor] Publishing to QStash with URL: ${WORKER_URL}`);
        const qstashResult = await qstashClient.publishJSON({
          url: WORKER_URL,
          body: payload,
          retries: 3
        });
        
        console.log(`[RAG Processor] Successfully queued chunk ${chunkIndex+1}, QStash messageId: ${qstashResult?.messageId || 'unknown'}`);
        
      } catch (error) {
        console.error(`[RAG Processor] Error queueing job for chunk ${chunkIndex}:`, error);
        if (error instanceof Error && error.message.includes('invalid destination url')) {
          console.error(`[RAG Processor] URL format error. Worker URL being used: "${WORKER_URL}"`);
          console.error(`[RAG Processor] Original QSTASH_WORKER_URL env variable: "${rawWorkerUrl}"`);
        }
        // We continue processing other chunks even if one fails
      }
    }));
    
    console.log(`[RAG Processor] Successfully queued ${totalChunks} embedding jobs for document ${documentId}`);
    
    return {
      success: true,
      message: `Document processed and ${totalChunks} embedding jobs queued`
    };
  } catch (error) {
    console.error(`[RAG Processor] Error processing document ${documentId}:`, error);
    
    // Update document status to failed
    await updateFileRagStatus({ 
      id: documentId, 
      processingStatus: 'failed', 
      statusMessage: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
    
    throw error;
  }
} 