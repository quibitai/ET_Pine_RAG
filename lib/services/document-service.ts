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
 * @returns boolean - True if deletion succeeded for ALL provided documents, false otherwise.
 */
export async function pineconeDeleteEmbeddings(documentIds: string[]): Promise<boolean> {
  let overallSuccess = true; // Assume success initially
  
  if (!process.env.PINECONE_INDEX_NAME) {
    console.error('[Deletion] PINECONE_INDEX_NAME is not defined');
    return false; // Cannot proceed without index name
  }
  const indexName = process.env.PINECONE_INDEX_NAME;

  if (!documentIds || documentIds.length === 0) {
    console.warn('[Deletion] No document IDs provided for Pinecone deletion.');
    return true; // Nothing to delete, so technically successful
  }

  console.log(`[Deletion] Starting Pinecone embeddings deletion for documents: ${documentIds.join(', ')}`);

  for (const documentId of documentIds) {
    let documentDeletionSuccess = false; // Track success for this specific document
    try {
      // 1. Get document metadata for totalChunks
      const document = await getDocumentById({ id: documentId });
      if (!document) {
        console.warn(`[Deletion] Document ${documentId} not found in DB. Skipping Pinecone deletion for this ID.`);
        continue; // Move to the next document ID
      }

      const totalChunks = document.totalChunks;

      // 2. Generate vector IDs
      let vectorIdsToDelete: string[] = [];
      if (totalChunks && totalChunks > 0) {
        vectorIdsToDelete = Array.from({ length: totalChunks }, (_, i) => `${documentId}_chunk_${i}`);
        console.log(`[Deletion] Generated ${vectorIdsToDelete.length} vector IDs for document ${documentId}`);
      } else {
        console.warn(`[Deletion] Document ${documentId} has totalChunks=${totalChunks}. Cannot determine vector IDs.`);
        documentDeletionSuccess = true; // No vectors to delete
        continue; // Move to the next document ID
      }

      if (vectorIdsToDelete.length > 0) {
        const index = pineconeClient.index(indexName); // Get index instance
        if (!index) {
          throw new Error(`Failed to get Pinecone index object for '${indexName}'`);
        }

        const BATCH_SIZE = 1000;
        for (let i = 0; i < vectorIdsToDelete.length; i += BATCH_SIZE) {
          const batchIds = vectorIdsToDelete.slice(i, i + BATCH_SIZE);
          if (batchIds.length > 0) {

            // --- Start Intensive Debug Logging ---
            console.log(`\n[Deletion Debug] Preparing batch (start ${i}) for doc ${documentId}`);
            console.log(`[Deletion Debug] Batch IDs count: ${batchIds.length}`);
            const defaultNamespace = index.namespace(""); // Get namespace object

            if (!defaultNamespace) {
              console.error("[Deletion Debug] CRITICAL: Failed to get defaultNamespace object!");
            } else {
              console.log(`[Deletion Debug] typeof defaultNamespace: ${typeof defaultNamespace}`);
              console.log(`[Deletion Debug] typeof defaultNamespace.delete: ${typeof defaultNamespace.delete}`);
              try {
                // Log available keys/methods for more insight
                console.log("[Deletion Debug] defaultNamespace keys:", JSON.stringify(Object.keys(defaultNamespace)));
                // Also check prototype for methods that might not be enumerable
                console.log("[Deletion Debug] defaultNamespace prototype keys:", JSON.stringify(Object.getOwnPropertyNames(Object.getPrototypeOf(defaultNamespace))));
              } catch (logError) {
                console.error("[Deletion Debug] Error inspecting defaultNamespace object:", logError);
              }
            }
            // --- End Intensive Debug Logging ---

            // --- Attempt Deletion Call ---
            console.log(`[Deletion] Attempting delete on defaultNamespace for batch size ${batchIds.length} (start index ${i})...`);
            if (!defaultNamespace || typeof defaultNamespace.delete !== 'function') {
              console.error(`[Deletion Error] defaultNamespace object is invalid or missing delete method before batch ${i}`);
              // Throw error here to ensure overallSuccess becomes false
              throw new Error(`Pinecone namespace object invalid or missing delete method for batch ${i}`);
            }
            try {
              // *** Call delete on the namespace object - NO 'as any' ***
              await defaultNamespace.delete({ ids: batchIds });
              console.log(`[Deletion] Batch (start ${i}) deletion call completed successfully.`);
            } catch (batchDeleteError) {
              console.error(`[Deletion Error] Failed deleting batch (start ${i}):`, batchDeleteError);
              // Re-throw error to be caught by the outer try-catch for this documentId
              throw batchDeleteError;
            }
            // --- End Attempt Deletion Call ---
          }
        } // End Batch Loop
        console.log(`[Deletion] Completed all batch deletions for document ${documentId}`);
        documentDeletionSuccess = true;
      } else { // No vector IDs generated
        documentDeletionSuccess = true;
      }
    } catch (error) { // Catch errors for this documentId
      console.error(`[Deletion] Failed during Pinecone deletion process for document ${documentId}:`, error);
      overallSuccess = false; // Mark overall failure
    }
  } // End Main Document Loop

  console.log(`[Deletion] Pinecone embeddings deletion finished. Overall success status: ${overallSuccess}`);
  return overallSuccess;
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
  console.log(`Starting deletion process for document ${id} by user ${userId}`);
  try {
    // 1. Get the document to verify ownership and get the blob URL
    const document = await getDocumentById({ id });
    
    if (!document) {
      console.error(`Document ${id} not found`);
      throw new Error('Document not found');
    }
    
    if (document.userId !== userId) {
      console.error(`Unauthorized access to document ${id} by user ${userId}`);
      throw new Error('Unauthorized access to document');
    }
    
    console.log(`Document ${id} (${document.fileName}) found and verified for deletion`);
    
    // 2. Delete document vector embeddings from Pinecone
    let pineconeSuccess = false;
    try {
      console.log(`Attempting to delete embeddings for document ${id} from Pinecone`);
      pineconeSuccess = await pineconeDeleteEmbeddings([id]);
      if (!pineconeSuccess) {
        console.warn(`[API/Service] Pinecone deletion failed or partially failed for document ${id}.`);
      }
    } catch (pineconeError) {
      console.error(`[API/Service] Critical error calling pineconeDeleteEmbeddings for document ${id}:`, pineconeError);
      pineconeSuccess = false;
    }
    
    // 3. Delete the file from Vercel Blob storage if URL exists
    let blobSuccess = false;
    if (document.blobUrl) {
      try {
        console.log(`Attempting to delete blob for document ${id} at URL ${document.blobUrl}`);
        await del(document.blobUrl);
        blobSuccess = true;
        console.log(`Successfully deleted blob for document ${id}`);
      } catch (error) {
        console.error(`Error deleting blob for document ${id}:`, error);
        // Continue with deletion even if blob deletion fails
      }
    } else {
      console.log(`No blob URL found for document ${id}`);
    }
    
    // 4. Delete the document record from the database
    console.log(`Deleting document ${id} from database`);
    let dbSuccess = false;
    try {
      await db.delete(documents).where(and(
        eq(documents.id, id),
        eq(documents.userId, userId)
      ));
      dbSuccess = true;
      console.log(`Successfully deleted document ${id} from database`);
    } catch (dbError) {
      console.error(`Error deleting document ${id} from database:`, dbError);
    }
    
    // 5. Log deletion summary with accurate status
    console.log(`Document deletion summary for ${id}:
      - Database deletion: ${dbSuccess ? 'Success' : 'Failed'}
      - Pinecone embeddings deletion: ${pineconeSuccess ? 'Success' : 'Failed'}
      - Blob storage deletion: ${document.blobUrl ? (blobSuccess ? 'Success' : 'Failed') : 'N/A'}
    `);
    
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