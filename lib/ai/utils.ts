'use server';

// Import OpenAI for embeddings
import OpenAI from 'openai';
import { generateText } from 'ai';
import { myProvider } from './providers';

// Initialize with OpenAI for text-embedding-3-large
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

/**
 * Enhances a user search query using an LLM to optimize it for web search
 * @param originalQuery The original query from the user
 * @param chatHistory Optional conversation context to improve query enhancement
 * @param systemPrompt Optional system prompt of the calling assistant for context
 * @param ragContext Optional document context from RAG for additional context
 * @returns An enhanced query string optimized for web search
 */
export async function enhanceSearchQuery(
  originalQuery: string,
  chatHistory?: string,
  systemPrompt?: string,
  ragContext?: string
): Promise<string> {
  try {
    // Create a truly unique label for this instance
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const timeLabel = `enhance_search_query_${uniqueId}`;
    console.time(timeLabel);
    console.log(`Enhancing search query: "${originalQuery}"`);
    console.log(`Using system prompt context: ${systemPrompt ? 'Yes' : 'No'}`);
    console.log(`Using RAG context: ${ragContext ? 'Yes (' + ragContext.length + ' chars)' : 'No'}`);
    
    // Early return for very short queries that don't need enhancement
    if (originalQuery.trim().length < 5) {
      console.log('Query too short for enhancement, using as-is');
      console.timeEnd(timeLabel);
      return originalQuery;
    }
    
    // Maximum length for enhanced queries
    const MAX_QUERY_LENGTH = 300;
    
    // Construct the prompt for the LLM
    const prompt = `You are an expert search query optimizer skilled at creating concise, high-precision search queries.

YOUR TASK:
Transform the user's query into a concise, optimized search query that will yield relevant results from search engines.

REQUIREMENTS:
1. Output ONLY the enhanced query text - no other text, explanations, or formatting
2. Create a query under ${MAX_QUERY_LENGTH} characters
3. Focus on precision and relevance over verbosity
4. Include key domain-specific terminology
5. Use quotation marks for exact phrases when appropriate
6. Maintain the original intent of the query
7. For time-sensitive information, include "2025" or other relevant time indicators

${systemPrompt ? `DOMAIN CONTEXT (use relevant terms from this):\n${systemPrompt.substring(0, 500)}\n` : ''}

${ragContext ? `KNOWLEDGE BASE CONTEXT (extract key terms if relevant):\n${ragContext.substring(0, 500)}\n` : ''}

${chatHistory ? `CONVERSATION HISTORY (for context):\n${chatHistory.substring(0, 300)}\n` : ''}

Original Query: "${originalQuery}"

Enhanced Query:`;

    // Use a fast model for quick response
    const { text: enhancedQuery } = await generateText({
      model: myProvider.languageModel('openai-chat-model'),
      system: 'You are an expert search query optimizer. Return ONLY the enhanced query text with no explanations or additional content.',
      prompt: prompt,
      temperature: 0.3, // Lower temperature for more focused outputs
      maxTokens: 100,   // Limit token generation to ensure concise results
    });

    // Clean and validate the enhanced query
    let cleanedQuery = enhancedQuery.trim().replace(/^["']|["']$/g, ''); // Remove quotes if the model added them
    
    // Ensure query doesn't exceed max length
    if (cleanedQuery.length > MAX_QUERY_LENGTH) {
      cleanedQuery = cleanedQuery.substring(0, MAX_QUERY_LENGTH);
      console.log(`Enhanced query exceeded max length, truncated to ${MAX_QUERY_LENGTH} chars`);
    }
    
    // If enhancement failed or returned nothing useful, use original
    if (!cleanedQuery || cleanedQuery.length < 3) {
      console.log('Enhancement failed to produce valid result, using original query');
      console.timeEnd(timeLabel);
      return originalQuery;
    }
    
    console.log(`Original query (${originalQuery.length} chars): "${originalQuery}"`);
    console.log(`Enhanced query (${cleanedQuery.length} chars): "${cleanedQuery}"`);
    console.timeEnd(timeLabel);
    
    return cleanedQuery;
  } catch (error) {
    // Create a unique error label that won't conflict with the timing label
    const errorLabel = `enhance_search_query_error_${Date.now()}`;
    console.timeEnd(errorLabel); // This is safe even if the label doesn't exist
    
    // Log error but don't fail - fall back to original query
    console.error('Error enhancing search query:', error);
    console.log('Falling back to original query due to error');
    return originalQuery;
  }
}

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