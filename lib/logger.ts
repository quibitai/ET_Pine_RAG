/**
 * Log levels for the application
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Current log level from environment or default to INFO
 */
const currentLogLevel = 
  process.env.LOG_LEVEL 
    ? (LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO) 
    : LogLevel.INFO;

/**
 * Format a date for logging
 */
const formatDate = () => {
  return new Date().toISOString();
};

/**
 * Main logger utility for structured logging
 */
export const logger = {
  /**
   * Debug level logging
   */
  debug: (message: string, meta?: any) => {
    if (currentLogLevel <= LogLevel.DEBUG) {
      console.log(
        `[${formatDate()}] 🔍 DEBUG: ${message}`
      );
      if (meta) console.log(JSON.stringify(meta, null, 2));
    }
  },

  /**
   * Info level logging
   */
  info: (message: string, meta?: any) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(
        `[${formatDate()}] ℹ️ INFO: ${message}`
      );
      if (meta) console.log(JSON.stringify(meta, null, 2));
    }
  },

  /**
   * Warning level logging
   */
  warn: (message: string, meta?: any) => {
    if (currentLogLevel <= LogLevel.WARN) {
      console.log(
        `[${formatDate()}] ⚠️ WARN: ${message}`
      );
      if (meta) console.log(JSON.stringify(meta, null, 2));
    }
  },

  /**
   * Error level logging
   */
  error: (message: string, error?: any) => {
    if (currentLogLevel <= LogLevel.ERROR) {
      console.log(
        `[${formatDate()}] 🔴 ERROR: ${message}`
      );
      if (error) {
        if (error instanceof Error) {
          console.log(`Message: ${error.message}`);
          console.log(`Stack: ${error.stack}`);
        } else {
          console.log(JSON.stringify(error, null, 2));
        }
      }
    }
  },

  /**
   * Special method for logging RAG context information
   */
  ragContext: (userId: string, queryText: string, results: any) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(
        `[${formatDate()}] 📚 RAG CONTEXT: User ${userId.substring(0, 8)}... queried: "${queryText.substring(0, 100)}${queryText.length > 100 ? '...' : ''}"`
      );
      
      if (results?.matches?.length > 0) {
        console.log(`Found ${results.matches.length} matching chunks:`);
        results.matches.forEach((match: any, index: number) => {
          console.log(`  ${index + 1}. ID: ${match.id?.substring(0, 12) || 'unknown'} | Score: ${match.score?.toFixed(4) || 'unknown'} | Source: ${match.metadata?.source || 'unknown'}`);
          if (match.metadata?.text) {
            const preview = match.metadata.text.substring(0, 100);
            console.log(`     Preview: "${preview}${match.metadata.text.length > 100 ? '...' : ''}"`);
          }
        });
      } else {
        console.log(`No matching chunks found`);
      }
    }
  },

  /**
   * Special method for logging search information
   */
  searchInfo: (originalQuery: string, enhancedQuery: string, results: any[]) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(
        `[${formatDate()}] 🔍 SEARCH: Original query: "${originalQuery}"`
      );
      console.log(
        `Enhanced query: "${enhancedQuery}"`
      );
      
      if (results?.length > 0) {
        console.log(`Found ${results.length} search results:`);
        results.forEach((result: any, index: number) => {
          console.log(`  ${index + 1}. Title: ${result.title || 'Untitled'} | URL: ${result.url || 'No URL'}`);
          if (result.content) {
            const preview = result.content.substring(0, 100);
            console.log(`     Preview: "${preview}${result.content.length > 100 ? '...' : ''}"`);
          }
        });
      } else {
        console.log(`No search results found`);
      }
    }
  },

  /**
   * Special method for logging document processing
   */
  documentProcess: (document: any, status: string, message?: string) => {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(
        `[${formatDate()}] 📄 DOCUMENT: ${status.toUpperCase()} | ID: ${document.id?.substring(0, 8) || 'unknown'} | Name: ${document.fileName || 'unnamed'}`
      );
      
      if (message) {
        console.log(`  Message: ${message}`);
      }
      
      if (document.totalChunks && document.processedChunks !== undefined) {
        const percentage = document.totalChunks > 0 
          ? Math.round((document.processedChunks / document.totalChunks) * 100) 
          : 0;
        console.log(`  Progress: ${document.processedChunks}/${document.totalChunks} chunks (${percentage}%)`);
      }
    }
  }
};

export default logger; 