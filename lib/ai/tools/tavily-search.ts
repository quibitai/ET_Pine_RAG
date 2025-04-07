import { tool } from 'ai';
import { z } from 'zod';
import { tavily } from '@tavily/core';

// Initialize Tavily client with API key from environment variables
const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY || '',
});

// Minimum relevance score threshold for filtering out low-quality results
const MIN_RELEVANCE_SCORE = 0.5;

export const tavilySearch = tool({
  description: 'Search the web for real-time information using Tavily search engine. Use this tool to find current information, news, and data not available in the AI\'s training data. Perfect for fact-checking, finding recent events, and answering queries about current information.',
  parameters: z.object({
    query: z.string().describe('The search query to look up. Make this specific, clear, and concise (under 300 characters).'),
    include_domains: z.array(z.string()).optional().describe('Optional list of domains to specifically include in the search'),
    exclude_domains: z.array(z.string()).optional().describe('Optional list of domains to exclude from the search'),
    search_depth: z.enum(['basic', 'advanced']).optional().describe('The depth of search to perform. Default is "advanced".'),
    max_results: z.number().min(1).max(10).optional().describe('Maximum number of results to return. Default is 5.'),
    include_answer: z.boolean().optional().describe('Whether to include an AI-generated answer summary. Default is false.'),
    include_raw_content: z.boolean().optional().describe('Whether to include the raw HTML content. Default is false.'),
    time_range: z.enum(['day', 'week', 'month', 'year']).optional().describe('Time range for search results.'),
    topic: z.enum(['general', 'news', 'finance']).optional().describe('Specific topic to focus the search on'),
  }),
  execute: async ({ 
    query, 
    include_domains = [], 
    exclude_domains = [], 
    search_depth = 'advanced', 
    max_results = 5,
    include_answer = false,
    include_raw_content = false,
    time_range,
    topic
  }) => {
    try {
      console.log(`[Tavily Tool] Executing search with query: "${query}"`);
      console.log(`[Tavily Tool] Search parameters: depth=${search_depth}, max_results=${max_results}, time_range=${time_range || 'default'}, topic=${topic || 'none'}`);
      
      // Perform a search with the Tavily API using provided parameters
      const response = await tvly.search(query, {
        search_depth,
        include_domains,
        exclude_domains,
        max_results,
        include_answer,
        include_raw_content,
        ...(time_range && { time_range }),
        ...(topic && { topic })
      });

      // Log the raw results immediately after receiving them
      console.log(`[Tavily Tool] Raw results received from Tavily: ${response.results.length} results`);
      
      // Filter out low-quality results based on relevance score
      const filteredResults = response.results
        .filter(result => (result.score || 0) >= MIN_RELEVANCE_SCORE)
        .map(result => ({
          title: result.title || 'Untitled',
          url: result.url || '',
          content: result.content || '',
          score: result.score || 0,
          published_date: result.publishedDate || null
        }));
      
      console.log(`[Tavily Tool] After filtering (min score ${MIN_RELEVANCE_SCORE}): ${filteredResults.length} results remain`);
      
      // Create search metadata for internal use
      const searchInfo = {
        query: {
          original: query,
          executed: query
        },
        parameters: {
          search_depth,
          max_results,
          include_domains: include_domains.length > 0 ? include_domains : undefined,
          exclude_domains: exclude_domains.length > 0 ? exclude_domains : undefined,
          time_range: time_range || undefined,
          topic: topic || undefined
        },
        results: filteredResults
      };
      
      // Include the AI-generated answer if it was requested and provided
      const answer = include_answer && response.answer ? response.answer : undefined;
      
      return {
        results: filteredResults,
        query: {
          executed: query 
        },
        answer,
        message: filteredResults.length > 0 
          ? `Found ${filteredResults.length} relevant results for your query.` 
          : 'No relevant results found for your query.',
      };
    } catch (error) {
      console.error('[Tavily Tool] Search error:', error);
      
      // Categorize error types for better debugging
      let errorMessage = 'Error performing web search: ';
      
      if (error instanceof Error) {
        // Extract specific error types for better error handling
        if (error.message.includes('rate limit')) {
          errorMessage += 'Rate limit exceeded. Please try again in a moment.';
        } else if (error.message.includes('timeout')) {
          errorMessage += 'Search timed out. Please try a more specific query.';
        } else if (error.message.includes('api key')) {
          errorMessage += 'API authentication error.';
          console.error('[Tavily Tool] API key issue detected');
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += String(error);
      }
      
      return {
        results: [],
        query: {
          executed: query
        },
        message: errorMessage,
      };
    }
  },
}); 