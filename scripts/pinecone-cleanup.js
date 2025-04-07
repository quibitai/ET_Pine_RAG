#!/usr/bin/env node

/**
 * Simple Pinecone Cleanup Script
 * 
 * This script uses a minimal approach to connect to Pinecone and delete all vectors
 * It's based on the working initialization approach from the test-pinecone-connection.mjs
 */

const { Pinecone } = require('@pinecone-database/pinecone');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
console.log('Loading environment variables...');
try {
  const envPaths = ['.env.local', '.env'];
  for (const envPath of envPaths) {
    const fullPath = path.join(process.cwd(), envPath);
    if (fs.existsSync(fullPath)) {
      console.log(`Loading from ${envPath}`);
      dotenv.config({ path: fullPath });
      break;
    }
  }
} catch (error) {
  console.warn('Warning: Failed to load .env file:', error);
}

// Get environment variables
const INDEX_NAME = process.env.PINECONE_INDEX_NAME;
const API_KEY = process.env.PINECONE_API_KEY;

// Validate required variables
if (!API_KEY) {
  console.error('❌ Error: PINECONE_API_KEY environment variable is not defined');
  process.exit(1);
}

if (!INDEX_NAME) {
  console.error('❌ Error: PINECONE_INDEX_NAME environment variable is not defined');
  process.exit(1);
}

console.log('\n🧹 Pinecone Simple Cleanup Script');
console.log('==========================');
console.log(`INDEX_NAME: ${INDEX_NAME}`);
console.log(`API_KEY present: ${!!API_KEY}`);
console.log('==========================\n');

async function cleanupPineconeIndex() {
  try {
    // Step 1: Initialize Pinecone client with minimal config
    console.log('Step 1: Initializing Pinecone client...');
    const pineconeClient = new Pinecone({
      apiKey: API_KEY
    });
    console.log('✅ Client initialized successfully\n');
    
    // Step 2: Get the index
    console.log(`Step 2: Getting index '${INDEX_NAME}'...`);
    const index = pineconeClient.index(INDEX_NAME);
    console.log('✅ Index retrieved\n');
    
    // Step 3: Get index stats before deletion
    console.log('Step 3: Fetching index stats before deletion...');
    try {
      const stats = await index.describeIndexStats();
      console.log('Index statistics:');
      console.log(`- Total vectors: ${stats.totalRecordCount || 0}`);
      console.log(`- Dimension: ${stats.dimension || 'unknown'}`);
      
      // Show namespaces if any exist
      if (stats.namespaces && Object.keys(stats.namespaces).length > 0) {
        console.log('- Namespaces:');
        Object.entries(stats.namespaces).forEach(([name, ns]) => {
          console.log(`  - ${name || 'default'}: ${ns.recordCount} vectors`);
        });
      } else {
        console.log('- No namespaces or empty index');
      }
      
      if (stats.totalRecordCount === 0) {
        console.log('\n✅ Index is already empty. Nothing to delete.');
        return;
      }
    } catch (error) {
      console.error('❌ Failed to get index stats:', error);
      console.log('Continuing with deletion anyway...');
    }
    
    // Step 4: Delete all vectors
    console.log('\nStep 4: Deleting all vectors...');
    
    // First try to delete from default namespace
    try {
      console.log('Deleting vectors from default namespace...');
      await index.deleteAll();
      console.log('✅ Successfully deleted vectors from default namespace');
    } catch (error) {
      console.error('❌ Failed to delete vectors from default namespace:', error);
    }
    
    // Try to check for other namespaces and delete from them
    try {
      const updatedStats = await index.describeIndexStats();
      if (updatedStats.namespaces && Object.keys(updatedStats.namespaces).length > 0) {
        for (const [namespaceName, namespaceData] of Object.entries(updatedStats.namespaces)) {
          if (namespaceName && namespaceData.recordCount > 0) {
            try {
              console.log(`Deleting vectors from namespace: ${namespaceName}...`);
              await index.namespace(namespaceName).deleteAll();
              console.log(`✅ Successfully deleted vectors from namespace: ${namespaceName}`);
            } catch (nsError) {
              console.error(`❌ Failed to delete vectors from namespace ${namespaceName}:`, nsError);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Failed to check for additional namespaces:', error);
    }
    
    // Final verification
    try {
      console.log('\nPerforming final verification...');
      const finalStats = await index.describeIndexStats();
      console.log(`Final verification - Total vectors: ${finalStats.totalRecordCount || 0}`);
      
      if (finalStats.totalRecordCount === 0) {
        console.log('🎉 Successfully deleted all vectors from Pinecone index!');
      } else {
        console.warn(`⚠️ Some vectors may remain in the index. Total count: ${finalStats.totalRecordCount}`);
      }
    } catch (error) {
      console.error('❌ Failed to get final verification stats:', error);
    }
    
    console.log('\n✅ Pinecone cleanup process completed');
  } catch (error) {
    console.error('\n❌ Error during Pinecone cleanup:', error);
    throw error;
  }
}

// Run the cleanup function
cleanupPineconeIndex()
  .then(() => {
    console.log('Script execution completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  }); 