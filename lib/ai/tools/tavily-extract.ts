import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

// Initialize Tavily client with API key from environment variables
const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
});

// Define types for Tavily Extract API response
interface TavilyExtractResponse {
  content?: string;
  title?: string;
  date?: string;
  images?: string[];
  [key: string]: any;
}

/**
 * Tavily Extract tool for extracting detailed content from specific URLs
 * This tool is meant to be used after tavilySearch to get more comprehensive content
 * from promising URLs identified in the search results
 */
export const tavilyExtract = tool({
  description: 'Extracts detailed content from a list of specified URLs using the Tavily Extract API. Use this after using tavilySearch to get more comprehensive information from promising URLs.',
  parameters: z.object({
    urls: z.array(z.string()).describe('A list of URLs to extract content from. Should be URLs retrieved from a previous tavilySearch call. Limit to 1-3 most relevant URLs.'),
    extract_depth: z.enum(['basic', 'advanced']).describe('Depth of extraction. "basic" is faster, "advanced" gets more content but takes longer. Recommended: basic.'),
    include_images: z.boolean().describe('Whether to include images in the extraction results. Recommended: false.'),
    max_tokens_per_url: z.number().describe('Maximum number of tokens to extract per URL. Recommended: 8000. Range: 1000-16000.'),
  }),
  execute: async ({ 
    urls, 
    extract_depth = 'basic', 
    include_images = false,
    max_tokens_per_url = 8000
  }) => {
    try {
      // Create a unique ID for this extraction request for easier log tracking
      const extractId = `te_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      
      // Validate input URLs
      if (!urls || urls.length === 0) {
        return {
          results: [],
          message: 'No URLs provided for extraction.'
        };
      }

      console.log(`[Tavily Extract ${extractId}] Extracting content from ${urls.length} URLs with depth=${extract_depth}`);
      
      // Ensure include_images is always a boolean
      if (typeof include_images !== 'boolean') {
        console.warn(`[Tavily Extract ${extractId}] WARNING: include_images is ${typeof include_images}, converting to boolean`);
        include_images = Boolean(include_images);
      }
      
      // Validate max_tokens_per_url
      const validatedMaxTokens = Math.max(1000, Math.min(16000, max_tokens_per_url));
      if (validatedMaxTokens !== max_tokens_per_url) {
        console.log(`[Tavily Extract ${extractId}] Adjusted max_tokens_per_url from ${max_tokens_per_url} to ${validatedMaxTokens}`);
      }
      
      // Call Tavily Extract API
      const results = await Promise.all(
        urls.map(async (url) => {
          try {
            console.log(`[Tavily Extract ${extractId}] Processing URL: ${url}`);
            
            // Call the extract API for this URL - passing the URL as an array as required by the API
            const response = await tvly.extract([url], {
              extract_depth,
              include_images,
              max_tokens: validatedMaxTokens
            }) as TavilyExtractResponse;
            
            return {
              url,
              success: true,
              title: response.title || 'Untitled',
              content: response.content || 'No content extracted',
              contentLength: response.content?.length || 0,
              date: response.date || null,
              images: response.images || []
            };
          } catch (error) {
            console.error(`[Tavily Extract ${extractId}] Error extracting content from ${url}:`, error);
            return {
              url,
              success: false,
              error: error instanceof Error ? error.message : String(error),
              title: null,
              content: null,
              contentLength: 0,
              date: null,
              images: []
            };
          }
        })
      );
      
      // Count successful extractions
      const successfulExtractions = results.filter(r => r.success).length;
      console.log(`[Tavily Extract ${extractId}] Completed extraction: ${successfulExtractions}/${urls.length} URLs successful`);
      
      // Format results for return
      const formattedResults = results.map(({ url, success, title, content, contentLength, date, images, error }) => ({
        url,
        success,
        title,
        content: content ? (content.length > 500 ? `${content.substring(0, 500)}... (${contentLength} chars total)` : content) : null,
        full_content: content,
        date,
        ...(images && images.length > 0 ? { images } : {}),
        ...(error ? { error } : {})
      }));
      
      return {
        results: formattedResults,
        message: successfulExtractions > 0
          ? `Successfully extracted content from ${successfulExtractions} of ${urls.length} URLs.`
          : 'Failed to extract content from any of the provided URLs.'
      };
    } catch (error) {
      // Create a unique error ID
      const errorId = `te_err_${Date.now().toString(36)}`;
      console.error(`[Tavily Extract ${errorId}] Error during extraction process:`, error);
      
      // Categorize error types for better debugging
      let errorMessage = 'Error performing content extraction: ';
      
      if (error instanceof Error) {
        if (error.message.includes('rate limit')) {
          errorMessage += 'Rate limit exceeded. Please try again in a moment.';
        } else if (error.message.includes('timeout')) {
          errorMessage += 'Request timed out. The website may be slow or unresponsive.';
        } else if (error.message.includes('api key')) {
          errorMessage += 'API authentication error.';
          console.error(`[Tavily Extract ${errorId}] API key issue detected`);
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += String(error);
      }
      
      return {
        results: [],
        message: errorMessage
      };
    }
  },
}); 