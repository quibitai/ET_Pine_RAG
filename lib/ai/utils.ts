'use server';

// Import OpenAI for embeddings
import OpenAI from 'openai';

// Initialize with OpenAI for text-embedding-3-large
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

/**
 * Generates vector embeddings for the given text using OpenAI text-embedding-3-large
 * @param text Text to be embedded
 * @returns A vector of floating point numbers representing the text embedding
 */
export async function generateEmbeddings(text: string): Promise<number[]> {
  try {
    // Ensure the text isn't too long for the embedding model
    // text-embedding-3-large has an 8191 token limit
    const truncatedText = text.slice(0, 30000); // approximate character limit
    
    console.log(`Generating embeddings for text (length ${truncatedText.length})`);
    
    // Check for OpenAI API key
    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is missing');
      throw new Error('OpenAI API key is not configured');
    }
    
    console.log('Using OpenAI text-embedding-3-large model');
    
    // Generate embeddings with OpenAI
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: truncatedText,
      encoding_format: "float",
    });
    
    // Get the embedding vector
    const embedding = response.data[0].embedding;
    
    console.log(`Embeddings generated successfully. Dimensions: ${embedding.length}`);
    
    // Return the embedding vector
    return embedding;
  } catch (error) {
    console.error('Error generating embeddings:', error);
    // Use a default dimension for OpenAI text-embedding-3-large (3072)
    return new Array(3072).fill(0);
  }
} 