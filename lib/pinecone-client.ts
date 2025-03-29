'use server';

import { Pinecone } from '@pinecone-database/pinecone';

// This should match your Pinecone index name
const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'pine-rag';

if (!process.env.PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY is not defined in environment variables');
}

// Configuration options
const config: any = {
  apiKey: process.env.PINECONE_API_KEY,
};

// For Pinecone environment-based (classic) - use this approach
// If PINECONE_ENVIRONMENT is set, use environment-based configuration
if (process.env.PINECONE_ENVIRONMENT) {
  config.environment = process.env.PINECONE_ENVIRONMENT;
}
// If PINECONE_INDEX_HOST is set, use host-based configuration
// This is an alternative to the environment-based configuration
else if (process.env.PINECONE_INDEX_HOST) {
  config.indexHost = process.env.PINECONE_INDEX_HOST;
}
else {
  console.warn('Neither PINECONE_ENVIRONMENT nor PINECONE_INDEX_HOST is defined. Attempting to use serverless Pinecone configuration.');
}

// Create and export the Pinecone client
export const pineconeClient = new Pinecone(config);

// Helper function to get the index
export const getPineconeIndex = () => {
  return pineconeClient.index(INDEX_NAME);
}; 