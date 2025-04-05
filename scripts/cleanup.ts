/**
 * KNOWLEDGE BASE CLEANUP SCRIPT
 * 
 * This script completely cleans up all documents in the knowledge base system:
 * 1. Deletes all document records from the Neon database
 * 2. Deletes all vector embeddings from Pinecone
 * 3. Deletes all document files from Vercel Blob storage
 * 
 * CAUTION: This will permanently delete ALL documents and cannot be undone!
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { documents } from '@/lib/db/schema';
import postgres from 'postgres';
import { del } from '@vercel/blob';
import { pineconeClient } from '@/lib/pinecone-client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize database client
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);

// Main cleanup function
async function cleanupKnowledgeBase() {
  console.log('🧹 Starting complete knowledge base cleanup...');
  console.log('⚠️  WARNING: This will delete ALL documents and cannot be undone!');
  console.log('----------------------------------------');

  try {
    // Step 1: Fetch all documents from the database
    console.log('📑 Fetching all documents from database...');
    const allDocuments = await db.select().from(documents);
    console.log(`Found ${allDocuments.length} documents to delete.`);

    if (allDocuments.length === 0) {
      console.log('No documents found. Nothing to clean up.');
      return;
    }

    // Step 2: Delete all vector embeddings from Pinecone
    console.log('\n🧠 Deleting all vector embeddings from Pinecone...');
    const documentIds = allDocuments.map(doc => doc.id);
    
    // Verify Pinecone connection and index
    if (!process.env.PINECONE_INDEX_NAME) {
      throw new Error('PINECONE_INDEX_NAME is not defined in environment variables');
    }
    
    const indexName = process.env.PINECONE_INDEX_NAME;
    const index = pineconeClient.index(indexName);
    
    // Delete vectors in Pinecone for each document
    let pineconeDeleteSuccess = true;
    let totalVectorsDeleted = 0;
    
    for (const doc of allDocuments) {
      const documentId = doc.id;
      const totalChunks = doc.totalChunks || 0;
      
      if (totalChunks > 0) {
        try {
          const vectorIds = Array.from(
            { length: totalChunks }, 
            (_, i) => `${documentId}_chunk_${i}`
          );
          
          // Process in batches to avoid Pinecone limits
          const BATCH_SIZE = 1000;
          for (let i = 0; i < vectorIds.length; i += BATCH_SIZE) {
            const batchIds = vectorIds.slice(i, i + BATCH_SIZE);
            if (batchIds.length === 0) continue;
            
            console.log(`Deleting batch of ${batchIds.length} vectors for document ${documentId}...`);
            await index.deleteMany(batchIds);
            totalVectorsDeleted += batchIds.length;
          }
          
          console.log(`✅ Successfully deleted all ${totalChunks} vectors for document: ${doc.fileName}`);
        } catch (error) {
          console.error(`❌ Failed to delete vectors for document ${documentId}:`, error);
          pineconeDeleteSuccess = false;
        }
      } else {
        console.log(`⚠️ Document ${doc.fileName} has no chunks (totalChunks: ${totalChunks})`);
      }
    }
    
    console.log(`Pinecone deletion ${pineconeDeleteSuccess ? 'completed successfully' : 'had some failures'}`);
    console.log(`Total vectors deleted: ${totalVectorsDeleted}`);
    
    // Step 3: Delete all files from Vercel Blob storage
    console.log('\n🗑️  Deleting all files from Vercel Blob storage...');
    let blobDeleteSuccess = true;
    let blobsDeleted = 0;
    
    for (const doc of allDocuments) {
      if (doc.blobUrl) {
        try {
          await del(doc.blobUrl);
          console.log(`✅ Deleted file from Blob storage: ${doc.fileName}`);
          blobsDeleted++;
        } catch (error) {
          console.error(`❌ Failed to delete file from Blob storage: ${doc.fileName}`, error);
          blobDeleteSuccess = false;
        }
      } else {
        console.log(`⚠️ Document ${doc.fileName} has no blob URL`);
      }
    }
    
    console.log(`Blob storage deletion ${blobDeleteSuccess ? 'completed successfully' : 'had some failures'}`);
    console.log(`Total blobs deleted: ${blobsDeleted}`);
    
    // Step 4: Delete all document records from the database
    console.log('\n💾 Deleting all document records from database...');
    const deleted = await db.delete(documents).returning();
    console.log(`✅ Successfully deleted ${deleted.length} document records from database`);
    
    // Cleanup and summary
    console.log('\n----------------------------------------');
    console.log('🎉 Knowledge base cleanup completed!');
    console.log(`📊 Summary:
- Database records deleted: ${deleted.length}
- Vector embeddings deleted: ${totalVectorsDeleted} 
- Blob storage files deleted: ${blobsDeleted}
    `);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    // Close the database connection
    await client.end();
    console.log('Database connection closed.');
  }
}

// Run the cleanup function
cleanupKnowledgeBase()
  .then(() => {
    console.log('Cleanup script execution completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Cleanup script failed:', error);
    process.exit(1);
  }); 