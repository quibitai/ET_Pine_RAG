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
      
      // Save metadata for the response
      const metadata = {
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
      
      // Step 2: Select top most relevant results (1-3) based on score
      const topResults = searchResponse.results
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 3);
      
      // Instead of returning a JSON structure, return a formatted string
      if (topResults.length === 0) {
        // For empty results, return a plain text message
        console.log('[Tavily Tool] No relevant results found, returning plain text message');
        
        // Still save metadata in a hidden field for debugging
        return {
          text: "I couldn't find any relevant search results for your query.",
          _metadata: metadata
        };
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
      
      // For results with content, return a formatted string
      const formattedResults = enhancedResults.map(result => {
        return `TITLE: ${result.title}\nURL: ${result.url}\nCONTENT: ${result.content.substring(0, 500)}...\n`;
      }).join("\n---\n");
      
      const resultText = `Found ${enhancedResults.length} relevant results that might help answer your question:\n\n${formattedResults}`;
      
      // Return formatted text with hidden metadata
      return {
        text: resultText,
        _metadata: {
          ...metadata,
          enhancedResults: enhancedResults.map(r => ({
            title: r.title,
            url: r.url,
            // Truncate content for metadata to keep it manageable
            content: r.content.substring(0, 1000)
          }))
        }
      };
    } catch (error) {
      console.error('Tavily search error:', error);
      
      // Return a friendly error message
      return {
        text: "I encountered an error while searching the web. Let me try to answer based on what I already know.",
        _metadata: {
          error: error instanceof Error ? error.message : String(error),
          query: query
        }
      };
    }
  },
}); 