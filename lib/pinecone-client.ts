'use server';

import { Pinecone } from '@pinecone-database/pinecone';

const INDEX_NAME = process.env.PINECONE_INDEX_NAME; // Removed default here, will check later
const API_KEY = process.env.PINECONE_API_KEY;
const ENVIRONMENT = process.env.PINECONE_ENVIRONMENT; // For classic Pinecone
const INDEX_HOST = process.env.PINECONE_INDEX_HOST; // For serverless Pinecone

// --- Environment Variable Validation ---
if (!API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable is not defined.');
}
if (!INDEX_NAME) {
   throw new Error('PINECONE_INDEX_NAME environment variable is not defined.');
}
// Ensure only one connection method is actively used, or throw if neither is set
if (INDEX_HOST && ENVIRONMENT) {
     console.warn('Both PINECONE_INDEX_HOST and PINECONE_ENVIRONMENT are defined. Using PINECONE_INDEX_HOST (serverless).');
     // No need to throw, just prioritize INDEX_HOST below
} else if (!INDEX_HOST && !ENVIRONMENT) {
    // Depending on the Pinecone library version/setup, one might be required.
     throw new Error('Neither PINECONE_ENVIRONMENT nor PINECONE_INDEX_HOST is defined. Please provide one for Pinecone client configuration.');
}

// --- Build Configuration Object ---
// Start with only the required API key
const pineconeConfig: { apiKey: string; environment?: string; indexHost?: string } = {
  apiKey: API_KEY,
};

// Add INDEX_HOST if it exists (prioritized for serverless)
if (INDEX_HOST) {
  pineconeConfig.indexHost = INDEX_HOST;
}
// Otherwise, add ENVIRONMENT if it exists (for classic)
else if (ENVIRONMENT) {
  pineconeConfig.environment = ENVIRONMENT;
}

// --- Initialize Client ---
// Create the Pinecone client with the strictly formed config
export const pineconeClient = new Pinecone(pineconeConfig);

// --- Helper Function ---
// Helper function to get the index (remains the same logic, but added check)
export const getPineconeIndex = () => {
  // Re-check index name here just in case, though checked above
  if (!INDEX_NAME) {
     throw new Error('PINECONE_INDEX_NAME is missing, cannot get index.');
  }
  return pineconeClient.index(INDEX_NAME);
}; 