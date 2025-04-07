// Add type declaration at the top of the file
declare global {
  var lastTavilySearchInfo: any;
}

import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';
import axios from 'axios';

// Initialize Tavily client with API key from environment variables
const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
});

// Function to extract full content from URLs using Tavily's Extract API
async function extractContentFromUrls(urls: string[]) {
  try {
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
    
    // Call Tavily Extract API
    const response = await axios.post(
      'https://api.tavily.com/extract',
      { urls },
      { headers: { 'Content-Type': 'application/json', 'x-api-key': TAVILY_API_KEY } }
    );
    
    console.log(`[Tavily Extract] Successfully extracted content from ${response.data.length} URLs`);
    return response.data as Array<{
      url: string;
      raw_content: string;
      content: string;
    }>;
  } catch (error) {
    console.error('[Tavily Extract] Error extracting content:', error);
    return [];
  }
}

export const tavilySearch = tool({
  description: 'Search the web for real-time information using Tavily search engine. Expects an optimized query.',
  parameters: z.object({
    query: z.string().describe('The optimized search query to look up on the web'),
  }),
  execute: async ({ query }) => {
    try {
      console.log('Received search query:', query);
      
      // Step 1: Perform initial search with Tavily API
      const searchQuery = query;
      console.log(`[Tavily Tool] Executing search with provided query: "${searchQuery}"`);
      
      const searchResponse = await tvly.search(searchQuery, {
        search_depth: 'advanced',
        include_domains: [],
        exclude_domains: [],
        max_results: 5,
      });

      // Log the raw search results
      console.log(`[Tavily Tool] Raw results received from Tavily:`, JSON.stringify(searchResponse.results, null, 2));
      console.log('Tavily search response received:', searchResponse.results.length, 'results');
      
      // Create basic metadata that will be saved separately in the database
      console.log('[Tavily Tool] Creating metadata for logging/debugging');
      
      // Create search info metadata that will be stored in the database
      const searchInfo = {
        query: {
          executed: searchQuery
        },
        results: searchResponse.results.map(result => ({
          title: result.title || 'Untitled',
          url: result.url || '',
          content: result.content || '',
          score: result.score || 0
        }))
      };
      
      // Log this metadata
      console.log('[Tavily Tool] Search info metadata created:', JSON.stringify(searchInfo, null, 2));
      
      // Export this metadata to global object for route.ts to collect
      global.lastTavilySearchInfo = searchInfo;
      
      // Step 2: Select top most relevant results (1-3) based on score
      const topResults = searchResponse.results
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 3);
      
      // IMPORTANT: Process the results into plain text instead of returning a structured object
      if (topResults.length === 0) {
        // For empty results, just return a plain text response directly
        console.log('[Tavily Tool] No relevant results found');
        return "I couldn't find any relevant search results for your query.";
      }
      
      const topUrls = topResults.map(result => result.url).filter(url => !!url);
      console.log(`[Tavily Tool] Selected top ${topUrls.length} URLs for extraction:`, topUrls);
      
      // Step 3: Extract full content from top URLs
      const extractedContents = await extractContentFromUrls(topUrls);
      
      // Step 4: Combine search results with extracted content
      const enhancedResults = topResults.map(result => {
        // Find matching extracted content for this URL
        const extracted = extractedContents.find(item => item.url === result.url);
        
        return {
          title: result.title || 'Untitled',
          url: result.url || '',
          content: extracted?.raw_content || result.content || '',
          score: result.score || 0
        };
      });
      
      console.log(`[Tavily Tool] Enhanced ${enhancedResults.length} results with extracted content`);
      
      // Format the results as a plain text string that the model will directly use
      let resultText = `Found ${enhancedResults.length} relevant results that might help answer your question:\n\n`;
      
      enhancedResults.forEach((result, index) => {
        resultText += `[Source ${index+1}]: ${result.title}\n`;
        resultText += `URL: ${result.url}\n`;
        resultText += `Content: ${result.content.substring(0, 500)}...\n\n`;
      });
      
      // Store metadata in a separate object, not as part of the response
      console.log('[Tavily Tool] Processing complete, returning formatted text response');
      
      // Directly return plain text with no structured fields
      return resultText;
    } catch (error) {
      console.error('Tavily search error:', error);
      
      // Return a friendly error message as plain text
      return "I encountered an error while searching the web. Let me try to answer based on what I already know.";
    }
  },
}); 