/**
 * PINECONE CLEANUP SCRIPT
 * 
 * This script focuses only on deleting all vector embeddings from Pinecone
 * It provides detailed logging to troubleshoot any issues with Pinecone deletion
 */

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
try {
  const envPaths = ['.env.local', '.env'];
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

// Validate Pinecone environment variables
const validatePineconeConfig = () => {
  const requiredVars = [
    { name: 'PINECONE_API_KEY', value: process.env.PINECONE_API_KEY },
    { name: 'PINECONE_INDEX_NAME', value: process.env.PINECONE_INDEX_NAME },
  ];

  const optionalVars = [
    { name: 'PINECONE_INDEX_HOST', value: process.env.PINECONE_INDEX_HOST },
    { name: 'PINECONE_ENVIRONMENT', value: process.env.PINECONE_ENVIRONMENT }
  ];

  // Check required variables
  let missingVars = requiredVars.filter(v => !v.value);
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(v => console.error(`   - ${v.name}`));
    return false;
  }

  // Log all variables (masking API key)
  console.log('Pinecone Configuration:');
  console.log(`- PINECONE_API_KEY: ${process.env.PINECONE_API_KEY ? '******' : 'undefined'}`);
  console.log(`- PINECONE_INDEX_NAME: ${process.env.PINECONE_INDEX_NAME}`);
  console.log(`- PINECONE_INDEX_HOST: ${process.env.PINECONE_INDEX_HOST || 'not set'}`);
  console.log(`- PINECONE_ENVIRONMENT: ${process.env.PINECONE_ENVIRONMENT || 'not set'}`);

  return true;
};

// Initialize Pinecone client
const initPinecone = () => {
  console.log('\nInitializing Pinecone client...');
  try {
    const clientConfig: any = {
      apiKey: process.env.PINECONE_API_KEY!
    };

    // Add host URL if provided - using correct parameter name
    if (process.env.PINECONE_INDEX_HOST) {
      // Updated from 'serverlessHost' to 'controllerHostUrl' based on error message
      clientConfig.controllerHostUrl = process.env.PINECONE_INDEX_HOST;
      console.log(`Using host URL: ${process.env.PINECONE_INDEX_HOST}`);
    }

    // Initialize client
    const pinecone = new Pinecone(clientConfig);
    console.log('✅ Pinecone client initialized successfully');
    return pinecone;
  } catch (error) {
    console.error('❌ Failed to initialize Pinecone client:', error);
    throw error;
  }
};

// Clear all vectors from Pinecone index
const clearPineconeIndex = async () => {
  console.log('\n🧹 Starting Pinecone cleanup...');

  // Validate configuration
  if (!validatePineconeConfig()) {
    console.error('❌ Invalid Pinecone configuration. Cannot proceed.');
    process.exit(1);
  }

  try {
    // Initialize Pinecone client
    const pinecone = initPinecone();
    const indexName = process.env.PINECONE_INDEX_NAME!;

    console.log(`\nConnecting to Pinecone index: ${indexName}`);
    const index = pinecone.index(indexName);

    // First get index stats to see what we're working with
    try {
      console.log('\nFetching index stats...');
      const stats = await index.describeIndexStats();
      
      console.log('\nIndex stats:');
      console.log(`- Total vectors: ${stats.totalRecordCount}`);
      console.log(`- Dimension: ${stats.dimension}`);
      if (stats.namespaces) {
        console.log('- Namespaces:');
        Object.entries(stats.namespaces).forEach(([name, data]) => {
          console.log(`  - ${name || 'default'}: ${data.recordCount} vectors`);
        });
      }

      if (stats.totalRecordCount === 0) {
        console.log('\n✅ Index is already empty. Nothing to delete.');
        return;
      }
    } catch (error) {
      console.error('❌ Failed to fetch index stats:', error);
      console.warn('Continuing anyway to attempt deletion...');
    }

    // Try to delete all vectors using deleteAll
    try {
      console.log('\nAttempting to delete all vectors...');
      
      // Attempt the deleteAll operation on the default namespace
      console.log('Deleting vectors in default namespace...');
      await index.deleteAll();
      console.log('✅ Successfully deleted all vectors in default namespace');
      
      // Check if there are other namespaces to clean
      try {
        const updatedStats = await index.describeIndexStats();
        if (updatedStats.totalRecordCount && updatedStats.totalRecordCount > 0 && updatedStats.namespaces) {
          // Delete from other namespaces if any exist
          for (const [namespace, data] of Object.entries(updatedStats.namespaces)) {
            if (namespace && data.recordCount > 0) {
              console.log(`Deleting vectors in namespace: ${namespace}`);
              // Use the namespace method to target specific namespace
              await index.namespace(namespace).deleteAll();
              console.log(`✅ Successfully deleted all vectors in namespace: ${namespace}`);
            }
          }
        }
      } catch (error) {
        console.error('❌ Error while cleaning additional namespaces:', error);
      }
      
      // Final verification
      try {
        const finalStats = await index.describeIndexStats();
        console.log(`\nFinal verification - Total vectors: ${finalStats.totalRecordCount}`);
        if (finalStats.totalRecordCount === 0) {
          console.log('🎉 Successfully deleted all vectors from Pinecone index!');
        } else {
          console.warn(`⚠️ Some vectors may remain in the index. Total count: ${finalStats.totalRecordCount}`);
        }
      } catch (error) {
        console.error('❌ Failed to get final verification stats:', error);
      }
    } catch (error) {
      console.error('❌ Error during vector deletion:', error);
      console.error('\nTROUBLESHOOTING PINECONE DELETION:');
      console.error('1. Verify your Pinecone API key has write permissions');
      console.error('2. Check that your index name is correct');
      console.error('3. Ensure your account has permissions to modify this index');
      console.error('4. Try logging into the Pinecone console and manually clearing the index');
      
      throw error;
    }
  } catch (error) {
    console.error('\n❌ Failed to clear Pinecone index:', error);
    throw error;
  }
};

// Run the cleanup function
clearPineconeIndex()
  .then(() => {
    console.log('\nPinecone cleanup script execution completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nPinecone cleanup script failed:', error);
    process.exit(1);
  }); 