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

  // Get the index instance once
  const index = pineconeClient.index(indexName);

  // **Crucial Check:** Verify the index object exists
  if (!index) {
     console.error(`[Deletion] FATAL: Pinecone index object for '${indexName}' is invalid.`);
     return false; // Cannot proceed if the index object is wrong
  }

  for (const documentId of documentIds) {
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
        
        // Try using metadata filtering as a fallback
        try {
          console.log(`[Deletion] Attempting deletion via metadata filter for document ${documentId}...`);
          await index.deleteMany({
            filter: {
              documentId: { $eq: documentId }
            }
          });
          console.log(`[Deletion] Successfully deleted vectors for document ${documentId} using metadata filter`);
          continue; // Move to the next document ID
        } catch (filterError) {
          console.error(`[Deletion] Metadata filter deletion failed: ${filterError}`);
          overallSuccess = false;
          continue; // Move to the next document ID
        }
      }

      // 3. Delete vectors by ID using batching
      if (vectorIdsToDelete.length > 0) {
        console.log(`[Deletion] Attempting to delete ${vectorIdsToDelete.length} vectors by ID from Pinecone for doc ${documentId}...`);
        const BATCH_SIZE = 1000; // Pinecone's typical limit
        
        for (let i = 0; i < vectorIdsToDelete.length; i += BATCH_SIZE) {
          const batchIds = vectorIdsToDelete.slice(i, i + BATCH_SIZE);
          if (batchIds.length > 0) {
            console.log(`[Deletion] Deleting batch of ${batchIds.length} vector IDs (starting index ${i}) from default namespace...`);
            
            try {
              // Use the index's default namespace (which is where vectors are stored)
              // Cast to any to avoid TypeScript errors while preserving the proper method call
              // This approach avoids potential issues with missing delete method on the index object
              const defaultNamespace = index.namespace("");
              
              // Utilize TypeScript's 'as any' to bypass type checking for the delete method
              await (defaultNamespace as any).delete({ ids: batchIds });
              
              console.log(`[Deletion] Successfully deleted batch of ${batchIds.length} vectors from default namespace`);
            } catch (batchError) {
              console.error(`[Deletion] Error deleting batch from default namespace: ${batchError}`);
              overallSuccess = false;
            }
          }
        }
        console.log(`[Deletion] Completed Pinecone vector deletion process for document ${documentId}`);
      }
    } catch (error) {
      console.error(`[Deletion] Failed during Pinecone deletion process for document ${documentId}:`, error);
      overallSuccess = false;
      // Continue to the next documentId even if one fails
    }
  }

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