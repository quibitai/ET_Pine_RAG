// Test script for the RAG pipeline
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FormData from 'form-data';
import { put } from '@vercel/blob';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

// Use import.meta.url to get the current module's URL
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Check for Vercel Blob token
const hasBlobToken = process.env.BLOB_READ_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN.length > 0;
console.log(`Vercel Blob token ${hasBlobToken ? 'found' : 'not found'}`);

// Mock put function for when we don't have a Blob token
const mockPut = async (fileName, fileContent, options) => {
  console.log(`MOCK: Would upload ${fileName} (size: ${fileContent.length} bytes) with options:`, options);
  
  // Create a local copy in a temp directory for testing
  const tempDir = path.join(__dirname, '../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const localPath = path.join(tempDir, fileName);
  fs.writeFileSync(localPath, fileContent);
  console.log(`MOCK: Saved file locally to ${localPath}`);
  
  // Return a fake blob URL that points to the local file
  return {
    url: `file://${localPath}`,
    contentType: options.contentType || 'application/octet-stream',
    size: fileContent.length,
  };
};

// Import our RAG processing functions - using dynamic imports for ESM compatibility
const importDeps = async () => {
  const ragProcessor = await import('../lib/rag-processor.js');
  const aiUtils = await import('../lib/ai/utils.js');
  const pineconeClient = await import('../lib/pinecone-client.js');
  const dbQueries = await import('../lib/db/queries.js');
  
  return {
    processFileForRag: ragProcessor.processFileForRag,
    generateEmbeddings: aiUtils.generateEmbeddings,
    getPineconeIndex: pineconeClient.getPineconeIndex,
    saveDocument: dbQueries.saveDocument,
    getDocumentById: dbQueries.getDocumentById,
    updateDocumentProcessingStatus: dbQueries.updateDocumentProcessingStatus
  };
};

async function uploadFileDirectly(filePath) {
  console.log(`\n--- Testing Direct File Upload ---`);
  try {
    const fileContent = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const fileType = path.extname(filePath).toLowerCase() === '.txt' ? 'text/plain' : 'application/pdf';
    
    console.log(`Uploading ${fileName} (${fileType})...`);
    
    // Use mock implementation if no token is available
    const blob = hasBlobToken 
      ? await put(fileName, fileContent, {
          access: 'public',
          contentType: fileType,
        })
      : await mockPut(fileName, fileContent, {
          access: 'public',
          contentType: fileType,
        });
    
    console.log(`✅ File uploaded to ${hasBlobToken ? 'Blob store' : 'local mock storage'}: ${blob.url}`);
    
    // Create document in database
    const { saveDocument } = await importDeps();
    const documentId = uuidv4();
    const document = {
      id: documentId,
      userId: 'test-user',
      name: fileName,
      url: blob.url,
      kind: 'text',
      type: fileType,
      size: fileContent.length,
      processingStatus: 'pending',
    };
    
    await saveDocument(document);
    console.log(`✅ Document metadata saved to database with ID: ${documentId}`);
    
    return { documentId, fileUrl: blob.url, fileType };
  } catch (error) {
    console.error(`❌ Error uploading file:`, error);
    throw error;
  }
}

async function testProcessing(documentId, fileUrl, fileType) {
  console.log(`\n--- Testing RAG Processing ---`);
  try {
    console.log(`Processing document ID: ${documentId}`);
    
    // First update status to processing
    const { updateDocumentProcessingStatus, processFileForRag, getDocumentById } = await importDeps();
    
    await updateDocumentProcessingStatus(documentId, 'processing');
    
    // Now process the file
    await processFileForRag({
      documentId,
      fileUrl,
      fileType,
      userId: 'test-user',
    });
    
    console.log(`✅ Document processing completed`);
    
    // Verify the document status
    const document = await getDocumentById(documentId);
    console.log(`Document status: ${document.processingStatus}`);
    
    return document;
  } catch (error) {
    console.error(`❌ Error processing document:`, error);
    throw error;
  }
}

async function testQuerying(query) {
  console.log(`\n--- Testing Vector Search ---`);
  try {
    const { generateEmbeddings, getPineconeIndex } = await importDeps();
    
    console.log(`Generating embeddings for query: "${query}"`);
    const embeddings = await generateEmbeddings(query);
    
    console.log(`Querying Pinecone with embeddings...`);
    const pineconeIndex = await getPineconeIndex();
    
    const queryResults = await pineconeIndex.query({
      vector: embeddings,
      topK: 5,
      includeMetadata: true,
    });
    
    console.log(`\n✅ Found ${queryResults.matches?.length || 0} relevant chunks:`);
    
    if (queryResults.matches && queryResults.matches.length > 0) {
      queryResults.matches.forEach((match, i) => {
        console.log(`\n--- Match ${i+1} (Score: ${match.score}) ---`);
        console.log(`${match.metadata.text}`);
        console.log(`\nSource: ${match.metadata.source}`);
      });
    } else {
      console.log(`No matches found.`);
    }
    
    return queryResults;
  } catch (error) {
    console.error(`❌ Error querying vector database:`, error);
    throw error;
  }
}

async function runTest() {
  try {
    console.log(`=== RAG Pipeline Test ===`);
    
    // Test file upload
    const filePath = path.join(__dirname, '../test-documents/rag-test-document.txt');
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Test file not found: ${filePath}`);
      return;
    }
    
    const { documentId, fileUrl, fileType } = await uploadFileDirectly(filePath);
    
    // Test processing
    const document = await testProcessing(documentId, fileUrl, fileType);
    
    // Wait a moment to ensure processing completes
    console.log(`Waiting a few seconds for processing to complete...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Test querying
    await testQuerying("What happened during the AI winter?");
    await testQuerying("How did deep learning transform AI?");
    
    console.log(`\n=== Test Completed Successfully ===`);
  } catch (error) {
    console.error(`\n❌ Test failed:`, error);
  }
}

// Run the test
runTest(); 