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
  // Start timing this function
  console.time('generateEmbeddings_total');
  console.log('=== Starting embedding generation ===');
  
  // Add retry mechanism
  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount < maxRetries) {
    try {
      // Enhanced API key validation - check early and provide detailed error message
      if (!OPENAI_API_KEY) {
        console.error('❌ CRITICAL ERROR: OPENAI_API_KEY environment variable is missing or empty');
        throw new Error('OpenAI API key is not configured');
      }
      
      // Check API key format (basic validation - should start with "sk-" for OpenAI keys)
      if (!OPENAI_API_KEY.startsWith('sk-')) {
        console.warn('⚠️ WARNING: OPENAI_API_KEY may be invalid - does not start with "sk-"');
        console.log(`OPENAI_API_KEY format: ${OPENAI_API_KEY.substring(0, 4)}... (showing first 4 chars only)`);
      }
      
      console.log('✅ OPENAI_API_KEY environment variable is present');
      
      // Ensure the text isn't too long for the embedding model
      // text-embedding-3-large has an 8191 token limit
      const originalLength = text.length;
      const truncatedText = text.slice(0, 30000); // approximate character limit
      
      console.log(`Generating embeddings for text (original length: ${originalLength}, truncated: ${truncatedText.length})`);
      
      console.log('Using OpenAI text-embedding-3-large model');
      
      // Generate embeddings with OpenAI - time this specific API call
      console.time('openai_embeddings_api_call');
      console.log(`Making OpenAI API call... (Attempt ${retryCount + 1}/${maxRetries})`);
      
      try {
        const response = await openai.embeddings.create({
          model: "text-embedding-3-large",
          input: truncatedText,
          encoding_format: "float",
        });
        
        console.timeEnd('openai_embeddings_api_call');
        console.log('OpenAI API call successful');
        
        // Get the embedding vector
        const embedding = response.data[0].embedding;
        
        console.log(`Embeddings generated successfully. Dimensions: ${embedding.length}`);
        console.timeEnd('generateEmbeddings_total');
        console.log('=== Embedding generation completed successfully ===');
        
        // Return the embedding vector
        return embedding;
        
      } catch (openaiError) {
        console.timeEnd('openai_embeddings_api_call');
        console.error(`OpenAI API call failed (Attempt ${retryCount + 1}/${maxRetries}):`, openaiError);
        
        // Enhanced error logging
        const errorDetails = openaiError instanceof Error ? {
          message: openaiError.message,
          name: openaiError.name,
          stack: openaiError.stack,
        } : 'Unknown error format';
        
        console.error('Error details:', JSON.stringify(errorDetails, null, 2));
        
        // Check for specific OpenAI API error types
        if (openaiError instanceof OpenAI.APIError) {
          console.error('OpenAI API Error Details:', {
            status: openaiError.status,
            headers: openaiError.headers,
            code: openaiError.code,
            type: openaiError.type,
          });
          
          // For rate limit errors, we should retry after a delay
          if (openaiError.status === 429 || (openaiError.code && openaiError.code === 'rate_limit_exceeded')) {
            console.log(`Rate limit hit. Retrying after delay...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
            throw openaiError; // Re-throw to trigger retry
          }
        }
        
        throw openaiError; // Re-throw to be caught by outer try-catch
      }
      
    } catch (error) {
      lastError = error;
      retryCount++;
      
      if (retryCount < maxRetries) {
        console.log(`Retrying embedding generation. Attempt ${retryCount + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
      } else {
        console.error(`All ${maxRetries} attempts to generate embeddings failed`);
        break;
      }
    }
  }
  
  // All retries failed, log and return fallback
  console.error('Error generating embeddings after all retries:', lastError);
  console.timeEnd('generateEmbeddings_total');
  console.log('=== Embedding generation failed after all retries ===');
  
  // Use a default dimension for OpenAI text-embedding-3-large (3072)
  console.warn('Returning fallback zero vector with 3072 dimensions');
  return new Array(3072).fill(0);
} 