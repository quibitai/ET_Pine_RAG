/**
 * KNOWLEDGE BASE CLEANUP SCRIPT
 * 
 * This script completely cleans up all documents in the knowledge base system:
 * 1. Deletes all document records from the Neon database
 * 2. Deletes all vector embeddings from Pinecone (if configured)
 * 3. Deletes all document files from Vercel Blob storage
 * 
 * CAUTION: This will permanently delete ALL documents and cannot be undone!
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { documents } from '@/lib/db/schema';
import postgres from 'postgres';
import { del } from '@vercel/blob';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables - try multiple paths to ensure variables are loaded
try {
  // Try different potential .env file locations
  const envPaths = [
    '.env.local',
    '.env',
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
  ];
  
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      console.log(`Loading environment variables from ${envPath}`);
      dotenv.config({ path: envPath });
      break;
    }
  }
} catch (error) {
  console.warn('Warning: Failed to load .env file:', error);
}

// Validate required environment variables for database
if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL environment variable is required');
}

// Validate database URL format
const validateDatabaseURL = (url: string): boolean => {
  // Basic format validation - should start with postgres:// or postgresql://
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    console.error(`❌ Invalid database URL format: ${url}`);
    console.error('Database URL should start with postgres:// or postgresql://');
    return false;
  }
  
  // Check if it's using localhost (which might not be running)
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('::1')) {
    console.warn(`⚠️ WARNING: Your database URL (${url}) is pointing to localhost.`);
    console.warn('Make sure your PostgreSQL server is running on your local machine.');
    console.warn('If you\'re trying to connect to a remote database (like Neon):');
    console.warn('1. Check your .env.local file');
    console.warn('2. Ensure POSTGRES_URL points to your remote database');
    console.warn('3. For Neon, the URL should look like: postgres://user:password@endpoint.region.neon.tech/database');
  }
  
  return true;
};

// Basic validation of the database URL
if (!validateDatabaseURL(process.env.POSTGRES_URL)) {
  throw new Error('Invalid POSTGRES_URL format');
}

// Initialize database client with better error handling
let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

try {
  console.log('Initializing database connection...');
  // Configure postgres with a timeout to avoid hanging
  client = postgres(process.env.POSTGRES_URL, {
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30 // 30 minutes
  });
  db = drizzle(client);
} catch (error) {
  console.error('❌ Failed to initialize database connection:', error);
  throw new Error('Database connection initialization failed');
}

// Check if Pinecone is properly configured
const isPineconeConfigured = () => {
  const hasPineconeConfig = 
    !!process.env.PINECONE_API_KEY && 
    !!process.env.PINECONE_INDEX_NAME;
  
  if (!hasPineconeConfig) {
    console.warn('\n⚠️ WARNING: Pinecone environment variables are missing:');
    console.warn('- PINECONE_API_KEY present:', !!process.env.PINECONE_API_KEY);
    console.warn('- PINECONE_INDEX_NAME:', process.env.PINECONE_INDEX_NAME);
    console.warn('- PINECONE_INDEX_HOST:', process.env.PINECONE_INDEX_HOST);
    console.warn('Vector embeddings will NOT be deleted from Pinecone.\n');
  }
  
  return hasPineconeConfig;
};

// Main cleanup function
async function cleanupKnowledgeBase() {
  console.log('🧹 Starting complete knowledge base cleanup...');
  console.log('⚠️  WARNING: This will delete ALL documents and cannot be undone!');
  console.log('----------------------------------------');

  try {
    // First, test the database connection
    try {
      console.log('Testing database connection...');
      // Simple query to test connection - using sql template string syntax
      await client`SELECT 1`;
      console.log('✅ Database connection successful');
    } catch (error) {
      console.error('❌ Database connection test failed:', error);
      console.error('\nTROUBLESHOOTING DATABASE CONNECTION:');
      console.error('1. Check if your PostgreSQL server is running');
      console.error('2. Verify your POSTGRES_URL in .env.local is correct');
      console.error('3. If using Neon or another cloud provider, check if:');
      console.error('   - Your IP address is allowlisted');
      console.error('   - Your database credentials are valid');
      console.error('   - The database exists and is active');
      console.error('\nFor Neon specifically:');
      console.error('1. Go to https://console.neon.tech');
      console.error('2. Find your project and database');
      console.error('3. Get the connection string and update your .env.local file');
      throw new Error('Database connection failed');
    }

    // Step 1: Fetch all documents from the database
    console.log('📑 Fetching all documents from database...');
    const allDocuments = await db.select().from(documents);
    console.log(`Found ${allDocuments.length} documents to delete.`);

    if (allDocuments.length === 0) {
      console.log('No documents found. Nothing to clean up.');
      return;
    }

    // Step 2: Delete all vector embeddings from Pinecone (if configured)
    let pineconeDeleteSuccess = false;
    let totalVectorsDeleted = 0;
    
    if (isPineconeConfigured()) {
      console.log('\n🧠 Deleting all vector embeddings from Pinecone...');
      
      try {
        // Import Pinecone client only if configured to avoid errors
        const { pineconeClient } = await import('@/lib/pinecone-client');
        const indexName = process.env.PINECONE_INDEX_NAME!;
        const index = pineconeClient.index(indexName);
        
        // Delete vectors in Pinecone for each document
        pineconeDeleteSuccess = true;
        
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
      } catch (error) {
        console.error('\n❌ Error accessing Pinecone:', error);
        console.warn('Skipping Pinecone cleanup due to errors, but continuing with other cleanup tasks...\n');
      }
    } else {
      console.log('\n🧠 Skipping Pinecone vector deletion due to missing configuration');
    }
    
    // Step 3: Delete all files from Vercel Blob storage
    console.log('\n🗑️  Deleting all files from Vercel Blob storage...');
    
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.warn('⚠️ BLOB_READ_WRITE_TOKEN is missing. Blob storage files may not be deleted properly.');
    }
    
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
- Pinecone vectors deleted: ${isPineconeConfigured() ? totalVectorsDeleted : 'SKIPPED - not configured'}
- Blob storage files deleted: ${blobsDeleted}
    `);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    // Close the database connection
    try {
      await client.end();
      console.log('Database connection closed.');
    } catch (err) {
      console.error('Error closing database connection:', err);
    }
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