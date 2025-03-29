declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PDFParseOptions {
    /**
     * Max number of pages to parse. Default is 0 (all pages)
     */
    max?: number;
    /**
     * Include version property in the result. Default is false
     */
    version?: boolean;
    /**
     * The default layout range.
     */
    layoutRange?: { 
      /**
       * A value between 0 and 100 representing the minimum width (as a percentage) 
       * of the page that content must span to be considered "readable".
       */
      width?: number;
      /**
       * A value between 0 and 100 representing the minimum height (as a percentage)
       * of the page that content must span to be considered "readable".
       */
      height?: number;
    };
  }

  interface PDFParseResult {
    /**
     * Number of pages
     */
    numpages: number;
    /**
     * Number of rendered pages
     */
    numrender: number;
    /**
     * PDF info
     */
    info: object;
    /**
     * PDF metadata
     */
    metadata: object;
    /**
     * PDF.js version
     */
    version?: string;
    /**
     * Parsed text
     */
    text: string;
  }

  function PDFParse(dataBuffer: Buffer, options?: PDFParseOptions): Promise<PDFParseResult>;
  
  export = PDFParse;
}

declare module 'pdf-parse' {
  import PDFParse from 'pdf-parse/lib/pdf-parse.js';
  export = PDFParse;
} 