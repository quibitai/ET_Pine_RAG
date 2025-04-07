import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

// Initialize Tavily client with API key from environment variables
const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
});

// Define interface for Tavily Extract response
interface TavilyExtractResponse {
  title?: string;
  content?: string;
  full_content?: string;
  date?: string;
  images?: string[];
  [key: string]: any; // Allow for additional fields
}

// Define simplified Zod schema for Tavily extract parameters
// Making ONLY 'urls' required, all other parameters optional
const tavilyExtractParams = z.object({
  urls: z.array(z.string()).describe('Required: List of URLs to extract content from. Should be URLs retrieved from a previous tavilySearch call.'),
  extract_depth: z.enum(['basic', 'advanced']).optional().describe('Optional: Depth of extraction. "basic" is faster, "advanced" gets more content but costs more. Default is basic.'),
  include_images: z.boolean().optional().describe('Optional: Whether to include images in the extraction. Default is false.'),
  max_tokens_per_url: z.number().optional().describe('Optional: Maximum number of tokens to extract per URL. Default is 8000.'),
});

/**
 * Tavily Extract tool for extracting detailed content from specific URLs
 * This tool is meant to be used after tavilySearch to get more comprehensive content
 * from promising URLs identified in the search results
 */
export const tavilyExtract = tool({
  description: 'Extracts detailed content from a list of specified URLs using the Tavily Extract API. Use this after using tavilySearch to get promising URLs.',
  parameters: tavilyExtractParams,
  execute: async ({ 
    urls, 
    extract_depth, 
    include_images,
    max_tokens_per_url
  }) => {
    try {
      // Define final parameters with defaults
      const final_extract_depth = extract_depth ?? 'basic';
      const final_include_images = include_images ?? false;
      const final_max_tokens_per_url = max_tokens_per_url ?? 8000;

      if (urls.length === 0) {
        return {
          message: "No URLs provided for extraction.",
          results: []
        };
      }

      // Log the extraction request
      console.log(`[Tavily Extract Tool] Extracting content from ${urls.length} URLs with depth=${final_extract_depth}`);
      
      // Extract content from each URL
      const extractionPromises = urls.map(async (url: string) => {
        try {
          console.log(`[Tavily Extract Tool] Processing URL: ${url}`);
          
          // Prepare extract options
          const extractOptions = {
            extract_depth: final_extract_depth,
            include_images: final_include_images,
            max_tokens: final_max_tokens_per_url
          };
          
          // Call Tavily's extract method with URL as array
          const extractResult = await tvly.extract([url], extractOptions) as TavilyExtractResponse;
          
          // Create a structured result
          return {
            url,
            success: true,
            title: extractResult.title || 'No title available',
            content: extractResult.content || 'No content extracted',
            full_content: extractResult.full_content || extractResult.content || 'No content extracted',
            date: extractResult.date || null,
            images: extractResult.images || [],
            extraction_depth: final_extract_depth
          };
        } catch (error) {
          console.error(`[Tavily Extract Tool] Failed to extract content from ${url}:`, error);
          
          // Return error information
          return {
            url,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            title: 'Extraction failed',
            content: 'Failed to extract content from this URL.',
            full_content: null,
            date: null,
            images: [],
            extraction_depth: final_extract_depth
          };
        }
      });
      
      // Wait for all extractions to complete
      const results = await Promise.all(extractionPromises);
      
      // Log the overall results
      const successCount = results.filter(r => r.success).length;
      console.log(`[Tavily Extract Tool] Completed extraction: ${successCount}/${urls.length} URLs successful`);
      
      return {
        message: `Extracted content from ${successCount} of ${urls.length} URLs.`,
        results: results
      };
    } catch (error) {
      console.error('[Tavily Extract Tool] Extraction error:', error);
      
      // Format error message based on type
      let errorMessage = 'Error extracting content: ';
      
      if (error instanceof Error) {
        if (error.message.includes('rate limit')) {
          errorMessage += 'Rate limit exceeded. Please try again in a moment.';
        } else if (error.message.includes('timeout')) {
          errorMessage += 'Extraction timed out. The URLs might be too complex or unavailable.';
        } else if (error.message.includes('api key')) {
          errorMessage += 'API authentication error.';
          console.error('[Tavily Extract Tool] API key issue detected');
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += String(error);
      }
      
      return {
        message: errorMessage,
        results: []
      };
    }
  },
}); 