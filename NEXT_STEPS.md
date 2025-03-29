# Next Steps: Implementing Phase 4 (RAG Integration)

Now that we've successfully completed Phase 3 with file uploads working properly, including the fallback mechanism for Vercel Blob, we're ready to implement the RAG (Retrieval Augmented Generation) system using Pinecone as our vector database.

## Prerequisites

Before beginning Phase 4, ensure:
1. You've completed Phase 3 and can successfully upload files
2. Your Pinecone API key is properly configured in your `.env.local` file
3. You have access to the Google embedding model for generating vector embeddings

## Step 1: Set Up Pinecone Client

First, we need to create a dedicated client for interacting with Pinecone:

1. Create a new file `lib/pinecone-client.ts`:

```typescript
import { Pinecone } from '@pinecone-database/pinecone';

// This should match your Pinecone index name
const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'pine-rag';

if (!process.env.PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY is not defined in environment variables');
}

// Configuration options
const config = {
  apiKey: process.env.PINECONE_API_KEY,
};

// For Pinecone serverless (newer) - use this approach
// const pc = new Pinecone({
//   apiKey: process.env.PINECONE_API_KEY,
// });

// For Pinecone environment-based (classic) - use this approach
// If PINECONE_ENVIRONMENT is set, use environment-based configuration
if (process.env.PINECONE_ENVIRONMENT) {
  config.environment = process.env.PINECONE_ENVIRONMENT;
}

// If PINECONE_INDEX_HOST is set, use host-based configuration
// This is an alternative to the environment-based configuration
else if (process.env.PINECONE_INDEX_HOST) {
  config.indexHost = process.env.PINECONE_INDEX_HOST;
}
else {
  throw new Error('Either PINECONE_ENVIRONMENT or PINECONE_INDEX_HOST must be defined');
}

// Create and export the Pinecone client
export const pineconeClient = new Pinecone(config);

// Helper function to get the index
export const getPineconeIndex = () => {
  return pineconeClient.index(INDEX_NAME);
};
```

## Step 2: Create Embedding Utility

Next, we'll create a utility for generating embeddings from text:

1. Create/Update `lib/ai/utils.ts`:

```typescript
import { google } from '@ai-sdk/google';

// Initialize the embedding model
const embeddingModel = google('models/text-embedding-004');

/**
 * Generates vector embeddings for the given text using Google's embedding model
 * @param text Text to be embedded
 * @returns A vector of floating point numbers representing the text embedding
 */
export async function generateEmbeddings(text: string): Promise<number[]> {
  try {
    // Ensure the text isn't too long for the embedding model
    // Most embedding models have a token limit (e.g., 8192 tokens)
    const truncatedText = text.slice(0, 10000);
    
    // Generate embeddings using the Google embedding model
    const response = await embeddingModel.embeddings({
      input: truncatedText,
    });
    
    // Return the embedding vector
    return response.embeddings[0].values;
  } catch (error) {
    console.error('Error generating embeddings:', error);
    throw new Error('Failed to generate embeddings');
  }
}
```

## Step 3: Set Up Document Processing

Now, let's create the RAG processor for handling document content:

1. Create a new file `lib/rag-processor.ts`:

```typescript
import { getPineconeIndex } from './pinecone-client';
import { generateEmbeddings } from './ai/utils';
import { updateFileRagStatus } from './db/queries';
import * as pdfParse from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fetch from 'node-fetch';

/**
 * Extracts text from a PDF buffer
 * @param buffer PDF file buffer
 * @returns Extracted text
 */
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer);
    return result.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

/**
 * Downloads a file from a URL
 * @param url URL to download from
 * @returns Buffer containing the file data
 */
async function downloadFile(url: string): Promise<Buffer> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
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
}) {
  try {
    console.log(`Starting RAG processing for document ${documentId}`);
    
    // Update status to processing
    await updateFileRagStatus({
      id: documentId,
      processingStatus: 'processing',
    });
    
    // Skip processing if using the fallback URL (development mode)
    if (fileUrl.includes('placeholder-blob-storage')) {
      console.log('Using placeholder URL - skipping actual RAG processing');
      await updateFileRagStatus({
        id: documentId,
        processingStatus: 'completed',
      });
      return;
    }
    
    // Download the file
    console.log(`Downloading file from ${fileUrl}`);
    const fileBuffer = await downloadFile(fileUrl);
    
    // Extract text based on file type
    let extractedText = '';
    if (fileType === 'application/pdf') {
      extractedText = await extractTextFromPDF(fileBuffer);
    } else if (fileType === 'text/plain') {
      extractedText = fileBuffer.toString('utf-8');
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // You'll need a library like mammoth for DOCX processing
      // For now, let's treat DOCX as unsupported
      extractedText = 'DOCX text extraction not implemented yet.';
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    
    // Skip if no text was extracted
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('No text extracted from document');
    }
    
    console.log(`Extracted ${extractedText.length} characters from document`);
    
    // Chunk the text
    const textChunks = chunkText(extractedText);
    console.log(`Split text into ${textChunks.length} chunks`);
    
    // Get Pinecone index
    const index = getPineconeIndex();
    
    // Process chunks and upload to Pinecone
    const vectors = [];
    
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      console.log(`Processing chunk ${i + 1}/${textChunks.length}`);
      
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
          timestamp: new Date().toISOString(),
        },
      });
      
      // Upload in batches to avoid rate limiting
      if (vectors.length === 10 || i === textChunks.length - 1) {
        console.log(`Upserting batch of ${vectors.length} vectors to Pinecone`);
        await index.upsert(vectors);
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
    
    // Update status to failed
    await updateFileRagStatus({
      id: documentId,
      processingStatus: 'failed',
    });
    
    return false;
  }
}
```

## Step 4: Update the Upload API Route

Now, update the createRagDocument function in `app/(chat)/api/files/upload/route.ts` to use our new RAG processor:

```typescript
// Function to trigger RAG processing for document
const createRagDocument = async (documentId: string, fileUrl: string, fileType: string, userId: string) => {
  try {
    console.log('Starting RAG document processing for document ID:', documentId);
    
    // Import the processFileForRag function
    const { processFileForRag } = await import('@/lib/rag-processor');
    
    // Set document status to processing
    await updateDocumentProcessingStatus({
      id: documentId,
      processingStatus: 'processing',
    });

    // Process the file (this could be long-running)
    // We'll run it asynchronously without awaiting to avoid timeout issues
    processFileForRag({
      documentId,
      fileUrl,
      fileType,
      userId,
    }).catch(error => {
      console.error('Error in RAG processing:', error);
    });

    return true;
  } catch (error) {
    console.error('Failed to process document for RAG:', error);
    await updateDocumentProcessingStatus({
      id: documentId,
      processingStatus: 'failed',
    });
    return false;
  }
};

// And update the call in the route handler:
if (['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type)) {
  try {
    console.log('Attempting to trigger RAG processing for document ID:', documentId);
    createRagDocument(documentId, blobUrl, file.type, session.user.id);
  } catch (error) {
    console.error('Failed to trigger RAG processing:', error);
    // We don't fail the request if RAG processing fails, just log it
  }
}
```

## Step 5: Implement Retrieval Logic

Update `app/(chat)/api/chat/route.ts` to retrieve and use document context:

1. Modify the POST function in `app/(chat)/api/chat/route.ts`:

```typescript
// Add these imports
import { generateEmbeddings } from '@/lib/ai/utils';
import { getPineconeIndex } from '@/lib/pinecone-client';

// Inside the POST function, before calling streamText:
// Add context retrieval
let contextText = '';
if (userMessage) {
  try {
    // Generate embeddings for the user's query
    const embedding = await generateEmbeddings(userMessage);
    
    // Query Pinecone for relevant chunks
    const index = getPineconeIndex();
    const queryResults = await index.query({
      vector: embedding,
      topK: 5,
      filter: { userId: session.user.id },
      includeMetadata: true,
    });
    
    // Extract and format the context text
    if (queryResults.matches.length > 0) {
      contextText = queryResults.matches
        .map(match => match.metadata?.text || '')
        .filter(text => text.length > 0)
        .join('\n\n');
      
      console.log('Found relevant context:', contextText.substring(0, 100) + '...');
    }
  } catch (error) {
    console.error('Error retrieving context:', error);
    // Continue without context if there's an error
  }
}

// Update systemPrompt to include context
let enhancedSystemPrompt = SYSTEM_PROMPT;
if (contextText) {
  enhancedSystemPrompt = `${SYSTEM_PROMPT}\n\nRELEVANT DOCUMENT CONTEXT:\n${contextText}\n\nUse the above context information to answer the user's question if relevant. If the context doesn't contain information relevant to the user's query, rely on your general knowledge.`;
}

// Then use the enhancedSystemPrompt in the streamText call
const response = await streamText({
  // ... other params
  system: enhancedSystemPrompt,
  // ... other params
});
```

## Step 6: Install Required Dependencies

For text extraction and document handling, we need to install additional packages:

```bash
pnpm add pdf-parse node-fetch@2 
pnpm add -D @types/pdf-parse @types/node-fetch
```

## Step 7: Test the RAG Pipeline

1. Start your development server: `pnpm dev`
2. Upload a PDF document using the UI
3. Ask questions about the content of the uploaded document
4. Verify that the system is retrieving and using the relevant context

## Troubleshooting

If you encounter issues:

1. **Pinecone Connection Errors**: 
   - Verify your API key and environment variables
   - Check that your Pinecone index exists and has the correct dimensions

2. **Embedding Generation Errors**:
   - Ensure your Google API key has access to the embedding model
   - Check for rate limiting issues

3. **PDF Parsing Errors**:
   - Some PDFs may be scanned images requiring OCR
   - Try with different PDF files to isolate the issue

4. **Vector Storage Issues**:
   - Verify the dimensionality of your embeddings matches Pinecone index settings
   - Check Pinecone console for error messages

## Next Steps After Completing Phase 4

Once Phase 4 is working, you'll be ready to move on to Phase 5, which focuses on:
1. Refining the prompts for better RAG integration
2. Testing with diverse document types
3. Optimizing the retrieval performance 