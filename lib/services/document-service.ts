import { and, eq } from 'drizzle-orm';
import { del } from '@vercel/blob';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { documents } from '@/lib/db/schema';
import { 
  getDocumentById,
  getUserDocuments,
  updateFileRagStatus
} from '@/lib/db/queries';
import { pineconeClient } from '@/lib/pinecone-client';
import { Client as QStashClient } from '@upstash/qstash';

// Initialize database client
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);

// Initialize QStash client
const qstashClient = new QStashClient({
  token: process.env.QSTASH_TOKEN!
});

// Helper function to ensure complete URL
function ensureCompleteUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

/**
 * Types for document operations
 */
export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type DocumentWithProgress = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  blobUrl: string;
  createdAt: Date;
  updatedAt: Date;
  processingStatus: DocumentStatus;
  statusMessage?: string;
  totalChunks?: number;
  processedChunks?: number;
};

/**
 * Delete embeddings from Pinecone for given document IDs
 * @param documentIds - Array of document IDs to delete
 */
export async function pineconeDeleteEmbeddings(documentIds: string[]) {
  try {
    if (!process.env.PINECONE_INDEX_NAME) {
      throw new Error('PINECONE_INDEX_NAME is not defined');
    }
    
    const index = pineconeClient.index(process.env.PINECONE_INDEX_NAME);
    
    // Delete vectors using a filter for the document IDs
    await index.deleteMany({
      filter: {
        documentId: { $in: documentIds }
      }
    });
    
    console.log(`Successfully deleted embeddings for documents: ${documentIds.join(', ')}`);
    return true;
  } catch (error) {
    console.error(`Failed to delete embeddings: ${error}`);
    throw error;
  }
}

/**
 * Get all documents for a user
 * @param userId - The ID of the user
 * @returns Array of user documents
 */
export async function getAllUserDocuments(userId: string) {
  try {
    const documents = await getUserDocuments({ userId });
    return documents;
  } catch (error) {
    console.error('Failed to get documents:', error);
    throw new Error('Failed to get documents');
  }
}

/**
 * Get document details by ID
 * @param id - The document ID
 * @returns Document details or null if not found
 */
export async function getDocumentDetails(id: string) {
  try {
    const document = await getDocumentById({ id });
    return document;
  } catch (error) {
    console.error(`Failed to get document ${id}:`, error);
    throw new Error('Failed to get document details');
  }
}

/**
 * Delete a document and its associated data
 * @param id - The document ID
 * @param userId - The user ID (for authorization)
 * @returns true if successful, throws error otherwise
 */
export async function deleteDocument(id: string, userId: string) {
  try {
    // 1. Get the document to verify ownership and get the blob URL
    const document = await getDocumentById({ id });
    
    if (!document) {
      throw new Error('Document not found');
    }
    
    if (document.userId !== userId) {
      throw new Error('Unauthorized access to document');
    }
    
    // 2. Delete document vector embeddings from Pinecone
    try {
      await pineconeDeleteEmbeddings([id]);
    } catch (error) {
      console.error(`Error deleting embeddings for document ${id}:`, error);
      // Continue with deletion even if Pinecone deletion fails
    }
    
    // 3. Delete the file from Vercel Blob storage if URL exists
    if (document.blobUrl) {
      try {
        await del(document.blobUrl);
      } catch (error) {
        console.error(`Error deleting blob for document ${id}:`, error);
        // Continue with deletion even if blob deletion fails
      }
    }
    
    // 4. Delete the document record from the database
    await db.delete(documents).where(and(
      eq(documents.id, id),
      eq(documents.userId, userId)
    ));
    
    return true;
  } catch (error) {
    console.error(`Failed to delete document ${id}:`, error);
    throw error;
  }
}

/**
 * Get document processing progress
 * @param id - The document ID
 * @returns Document processing status
 */
export async function getDocumentProgress(id: string): Promise<DocumentWithProgress | null> {
  try {
    const document = await getDocumentById({ id });
    
    if (!document) {
      return null;
    }
    
    return {
      id: document.id,
      fileName: document.fileName,
      fileType: document.fileType,
      fileSize: document.fileSize,
      blobUrl: document.blobUrl,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      processingStatus: document.processingStatus as DocumentStatus,
      statusMessage: document.statusMessage || undefined,
      totalChunks: document.totalChunks || undefined,
      processedChunks: document.processedChunks || 0,
    };
  } catch (error) {
    console.error(`Failed to get document progress for ${id}:`, error);
    return null;
  }
}

/**
 * Retry processing a failed document
 * @param id - The document ID
 * @param userId - The user ID (for authorization)
 * @returns true if successful, throws error otherwise
 */
export async function retryDocumentProcessing(id: string, userId: string) {
  try {
    // 1. Get the document to verify ownership
    const document = await getDocumentById({ id });
    
    if (!document) {
      throw new Error('Document not found');
    }
    
    if (document.userId !== userId) {
      throw new Error('Unauthorized access to document');
    }
    
    // Only retry if the document is in a failed state
    if (document.processingStatus !== 'failed') {
      throw new Error('Document is not in a failed state');
    }
    
    // 2. Update the document status to pending
    await updateFileRagStatus({
      id,
      processingStatus: 'pending',
      statusMessage: 'Retrying document processing'
    });
    
    // 3. Get necessary environment variables
    const rawWorkerUrl = process.env.QSTASH_WORKER_URL;
    if (!rawWorkerUrl) {
      throw new Error('QSTASH_WORKER_URL environment variable is not set');
    }
    
    // 4. Ensure complete URL with protocol
    const workerUrl = ensureCompleteUrl(rawWorkerUrl);
    
    // 5. Extract file extension from fileName
    const fileExtension = document.fileName.split('.').pop()?.toLowerCase() || '';
    
    // 6. Prepare job payload
    const jobPayload = {
      documentId: id,
      userId,
      fileExtension,
    };
    
    // 7. Queue document for processing
    console.log(`[Document Service] Enqueuing RAG job for document ${id} to worker URL: ${workerUrl}`);
    const publishResult = await qstashClient.publishJSON({
      url: workerUrl,
      body: jobPayload,
      retries: 3
    });
    
    if (!publishResult?.messageId) {
      throw new Error('Failed to queue document for processing (no message ID returned)');
    }
    
    console.log(`[Document Service] Successfully queued document ${id} for reprocessing. QStash Message ID: ${publishResult.messageId}`);
    
    // 8. Update status to show queued with messageId
    await updateFileRagStatus({
      id,
      processingStatus: 'pending',
      statusMessage: `Queued for processing (${publishResult.messageId})`
    });
    
    return true;
  } catch (error) {
    console.error(`Failed to retry processing for document ${id}:`, error);
    
    // Update document status to failed with error message
    try {
      await updateFileRagStatus({
        id,
        processingStatus: 'failed',
        statusMessage: `Failed to retry: ${error instanceof Error ? error.message : String(error)}`
      });
    } catch (updateError) {
      console.error('Failed to update document status:', updateError);
    }
    
    throw error;
  }
} 