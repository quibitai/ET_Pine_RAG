/**
 * PINECONE TEST DELETE SCRIPT
 * 
 * A minimal script to test connection and delete operation with your Pinecone index
 */

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables
try {
  const envPath = '.env.local';
  if (fs.existsSync(envPath)) {
    console.log(`Loading environment variables from ${envPath}`);
    dotenv.config({ path: envPath });
  }
} catch (error) {
  console.warn('Warning: Failed to load .env file:', error);
}

// Quick validation
if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
  console.error('❌ Missing required Pinecone environment variables');
  process.exit(1);
}

// Main test function
async function testPineconeDelete() {
  console.log('Pinecone Test Delete Script');
  console.log('==========================');
  
  // Log configuration
  console.log('\nEnvironment Variables:');
  console.log(`- PINECONE_API_KEY: ${process.env.PINECONE_API_KEY ? '****' : 'not set'}`);
  console.log(`- PINECONE_INDEX_NAME: ${process.env.PINECONE_INDEX_NAME || 'not set'}`);
  console.log(`- PINECONE_INDEX_HOST: ${process.env.PINECONE_INDEX_HOST || 'not set'}`);
  
  try {
    // 1. Initialize the client with minimal configuration
    console.log('\nStep 1: Initializing Pinecone client...');
    const pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!
    });
    console.log('✅ Client initialized');
    
    // 2. Get the index
    console.log(`\nStep 2: Getting index '${process.env.PINECONE_INDEX_NAME}'...`);
    const index = pc.index(process.env.PINECONE_INDEX_NAME!);
    console.log('✅ Index retrieved');
    
    // 3. Check index stats
    console.log('\nStep 3: Checking index stats...');
    try {
      const stats = await index.describeIndexStats();
      console.log('✅ Index stats retrieved:');
      console.log(`- Total vectors: ${stats.totalRecordCount}`);
      console.log(`- Dimension: ${stats.dimension}`);
      
      // Show namespaces if any exist
      if (stats.namespaces && Object.keys(stats.namespaces).length > 0) {
        console.log('- Namespaces:');
        Object.entries(stats.namespaces).forEach(([name, ns]) => {
          console.log(`  - ${name || 'default'}: ${ns.recordCount} vectors`);
        });
      } else {
        console.log('- No namespaces or empty index');
      }
    } catch (error) {
      console.error('❌ Failed to get index stats:', error);
      throw error;
    }
    
    // 4. Test a simple delete operation (only if vectors exist)
    console.log('\nStep 4: Testing deleteAll operation...');
    try {
      // Use default namespace first
      console.log('Attempting to delete all vectors in default namespace...');
      
      // Print what method we're using
      console.log(`Method being called: index.deleteAll()`);
      
      // Test the operation
      await index.deleteAll();
      console.log('✅ deleteAll operation completed successfully!');
      
      // Verify the operation worked
      const statsAfter = await index.describeIndexStats();
      console.log(`\nVerification - Default namespace vectors: ${statsAfter.namespaces?.['']?.recordCount || 0}`);
      
    } catch (error) {
      console.error('❌ Delete operation failed:', error);
      console.error('\nError details:');
      
      if (error instanceof Error) {
        console.error(`- Error name: ${error.name}`);
        console.error(`- Message: ${error.message}`);
        console.error(`- Stack: ${error.stack}`);
        
        // Check for specific Pinecone errors
        if (error.message.includes('404')) {
          console.error('\nTROUBLESHOOTING 404 ERROR:');
          console.error('- This likely means the endpoint URL is incorrect or the index does not exist');
          console.error('- Check that your PINECONE_INDEX_HOST is correct and includes https://');
          console.error('- Verify that your API key has access to this index');
        }
        
        if (error.message.includes('403')) {
          console.error('\nTROUBLESHOOTING 403 ERROR:');
          console.error('- This means your API key does not have permission to perform this operation');
          console.error('- Make sure your API key has write access to this index');
        }
        
        if (error.message.includes('401')) {
          console.error('\nTROUBLESHOOTING 401 ERROR:');
          console.error('- This means your API key is invalid or expired');
          console.error('- Generate a new API key in the Pinecone console');
        }
      }
      
      throw error;
    }
    
    console.log('\nAll tests completed successfully! 🎉');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testPineconeDelete()
  .then(() => {
    console.log('\nScript execution completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed with an error:', error);
    process.exit(1);
  }); 