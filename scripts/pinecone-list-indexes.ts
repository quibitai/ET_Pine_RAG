/**
 * PINECONE LIST INDEXES SCRIPT
 * 
 * This script lists all available Pinecone indexes to verify your API key's access.
 */

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import * as fs from 'fs';

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

// Validate Pinecone API key
if (!process.env.PINECONE_API_KEY) {
  console.error('❌ Missing PINECONE_API_KEY environment variable');
  process.exit(1);
}

// Initialize Pinecone client without any index-specific parameters
const initPinecone = () => {
  console.log('\nInitializing Pinecone client with API key only...');
  try {
    // Only use the API key without any host or environment variables
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!
    });
    console.log('✅ Pinecone client initialized successfully');
    return pinecone;
  } catch (error) {
    console.error('❌ Failed to initialize Pinecone client:', error);
    throw error;
  }
};

// List all available Pinecone indexes
const listPineconeIndexes = async () => {
  console.log('\n🔍 Listing all available Pinecone indexes...');
  
  try {
    // Initialize Pinecone client with just the API key
    const pinecone = initPinecone();
    
    // List all indexes
    console.log('Fetching indexes...');
    const indexList = await pinecone.listIndexes();
    
    if (!indexList.indexes || indexList.indexes.length === 0) {
      console.log('\n⚠️ No indexes found. You may need to:');
      console.log('1. Check if your API key is correct');
      console.log('2. Create an index in your Pinecone console');
      console.log('3. Make sure your account has the necessary permissions');
      return;
    }
    
    // Display all available indexes
    console.log('\n✅ Available Pinecone indexes:');
    indexList.indexes.forEach((index, i) => {
      console.log(`\n${i + 1}. Index: ${index.name}`);
      console.log(`   - Status: ${index.status}`);
      console.log(`   - Host: ${index.host}`);
      console.log(`   - Dimension: ${index.dimension}`);
      console.log(`   - Metric: ${index.metric}`);
    });
    
    // Compare with .env values
    const envIndexName = process.env.PINECONE_INDEX_NAME;
    const envIndexHost = process.env.PINECONE_INDEX_HOST;
    
    console.log('\n🔄 Comparing with your environment variables:');
    console.log(`- PINECONE_INDEX_NAME: ${envIndexName || 'not set'}`);
    console.log(`- PINECONE_INDEX_HOST: ${envIndexHost || 'not set'}`);
    
    // Check if the index in .env exists in the returned list
    if (envIndexName) {
      const matchingIndex = indexList.indexes.find(idx => idx.name === envIndexName);
      
      if (matchingIndex) {
        console.log(`\n✅ Found matching index "${envIndexName}" in your account.`);
        
        // Check if the host matches
        if (envIndexHost && matchingIndex.host && !envIndexHost.includes(matchingIndex.host)) {
          console.warn(`\n⚠️ WARNING: Your environment host URL doesn't match the actual index host!`);
          console.warn(`- Environment: ${envIndexHost}`);
          console.warn(`- Actual: ${matchingIndex.host}`);
          console.warn('This could be causing your connection issues.');
        }
      } else {
        console.error(`\n❌ Index "${envIndexName}" specified in your environment variables was NOT found in your account!`);
        console.error('This is likely the cause of your 404 errors.');
      }
    }
    
    // Suggest updating environment variables
    console.log('\n📋 Recommended next steps:');
    
    if (indexList.indexes.length > 0) {
      const firstIndex = indexList.indexes[0];
      console.log('Update your .env.local file with the following values:');
      console.log(`PINECONE_INDEX_NAME=${firstIndex.name}`);
      
      if (firstIndex.host) {
        // Format host to include https:// protocol
        const hostWithProtocol = firstIndex.host.startsWith('http') 
          ? firstIndex.host 
          : `https://${firstIndex.host}`;
        console.log(`PINECONE_INDEX_HOST=${hostWithProtocol}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Failed to list Pinecone indexes:', error);
    throw error;
  }
};

// Run the script
listPineconeIndexes()
  .then(() => {
    console.log('\nPinecone index listing completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed:', error);
    process.exit(1);
  }); 