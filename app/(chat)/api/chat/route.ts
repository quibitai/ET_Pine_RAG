import {
  UIMessage,
  appendResponseMessages,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from 'ai';
import { auth } from '@/app/(auth)/auth';
import { systemPrompt } from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  saveChat,
  saveMessages,
  getDocumentById,
  getMessageById,
} from '@/lib/db/queries';
import {
  generateUUID,
  getMostRecentUserMessage,
  getTrailingMessageId,
} from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { tavilySearch } from '@/lib/ai/tools/tavily-search';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { generateEmbeddings, enhanceSearchQuery } from '@/lib/ai/utils';
import { getPineconeIndex, queryPineconeWithDiagnostics } from '@/lib/pinecone-client';

// Set maxDuration to comply with Vercel Hobby plan limits (max 60 seconds)
export const maxDuration = 60;
export const runtime = 'nodejs';

// Define the structure of the Chain of Reason (CoR) state
interface CorState {
  "🗺️": string;    // Long term goal
  "🚦": number;    // Goal progress (-1, 0, or 1)
  "👍🏼": string;   // Inferred user preferences 
  "🔧": string;    // Adjustment to fine-tune response
  "🧭": string[];  // Step-by-Step strategy
  "🧠": string;    // Expertise descriptor
  "🗣": string;    // Verbosity of output (low, med, high)
  [key: string]: any; // Allow for additional fields
}

// Use the appropriate type when creating the initial CoR state
const initialCorState: CorState = {
  "🗺️": "Unknown",
  "🚦": 0,
  "👍🏼": "Unknown",
  "🔧": "Waiting to adjust based on response",
  "🧭": [
    "1. Gather information from the user",
    "2. Come up with a plan to help the user",
    "3. Help the user achieve their goal(s)"
  ],
  "🧠": "Expertise in gathering context, specializing in goal achievement using user input",
  "🗣": "Low"
};

// Updated helper function to properly clean formatting and remove any ET: prefix
function formatResponse(text: string): string {
  if (!text) return "";
  
  // Remove any leading "ET:" prefix
  let cleanedText = text;
  if (cleanedText.startsWith("ET:")) {
    cleanedText = cleanedText.substring(3).trim();
  }
  
  // Format JSON responses correctly - detect direct JSON output that should be formatted
  // Removing this block to ensure we see exactly what the LLM outputs
  /* 
  if (cleanedText.trim().startsWith('{') && cleanedText.includes('"results":')) {
    try {
      // This looks like raw Tavily results being output directly
      const jsonData = JSON.parse(cleanedText);
      
      // Check if this is Tavily search results
      if (jsonData.results && Array.isArray(jsonData.results)) {
        // Create a formatted version of the search results
        let formattedResults = "Here are some recent news stories I found:\n\n";
        
        jsonData.results.forEach((result: any, index: number) => {
          // Extract title and URL from the result
          const title = result.title || 'Untitled';
          const url = result.url || '';
          
          // Extract and clean up the content (first paragraph only for brevity)
          let content = result.content || '';
          content = content.split('\n')[0]; // First paragraph only
          
          // Add a numbered entry with title as a link, and the first part of the content
          formattedResults += `${index + 1}. **${title}**\n`;
          if (content) {
            formattedResults += `   ${content}\n`;
          }
          formattedResults += `   [Read more](${url})\n\n`;
        });
        
        formattedResults += "These stories highlight the most relevant recent information based on your query.";
        
        return formattedResults;
      }
    } catch (e) {
      // Not valid JSON, continue with normal processing
      console.log("Attempted to parse JSON in response but failed:", e);
    }
  }
  */
  
  return cleanedText.trim();
}

/**
 * Enhanced version that fetches document metadata from the database for attachments
 * to ensure proper content types are used instead of application/octet-stream
 */
async function enhanceAttachmentsWithMetadata(messages: Array<UIMessage>): Promise<Array<UIMessage>> {
  // If no messages have attachments, return early
  if (!messages.some(m => m.experimental_attachments && m.experimental_attachments.length > 0)) {
    return messages;
  }

  try {
    console.log('[Attachment Fix] Starting attachment enhancement for messages:', 
      messages.filter(m => m.experimental_attachments?.length).length);
    
    // Process each message
    const enhancedMessages = await Promise.all(messages.map(async message => {
      if (!message.experimental_attachments || message.experimental_attachments.length === 0) {
        return message;
      }
      
      console.log(`[Attachment Fix] Processing message ${message.id} with ${message.experimental_attachments.length} attachments`);
      
      // Process each attachment in this message
      const enhancedAttachments = await Promise.all(message.experimental_attachments.map(async (attachment, index) => {
        console.log(`[Attachment Fix] Processing attachment ${index+1}/${message.experimental_attachments?.length}:`, 
          { url: attachment.url?.substring(0, 30) + '...', name: attachment.name, contentType: attachment.contentType });
        
        // If contentType exists and is not empty and not application/octet-stream, keep it
        if (attachment.contentType && 
            attachment.contentType.trim() !== '' && 
            attachment.contentType !== 'application/octet-stream') {
          console.log(`[Attachment Fix] Keeping existing valid content type: ${attachment.contentType}`);
          return attachment;
        }
        
        // Check if attachment already has an explicit documentId property
        // @ts-ignore - Check if documentId exists on the attachment object
        let documentId = attachment.documentId || '';
        if (documentId) {
          console.log(`[Attachment Fix] Found explicit documentId property on attachment: ${documentId}`);
        }
        
        // If no explicit documentId, try multiple extraction methods
        if (!documentId) {
          // Method 1: Check if URL contains a UUID pattern that might be a document ID
          const urlMatch = attachment.url?.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
          if (urlMatch && urlMatch[1]) {
            documentId = urlMatch[1];
            console.log(`[Attachment Fix] Extracted document ID from URL: ${documentId}`);
          }
          
          // Method 2: Check if name is a UUID (sometimes attachment.name is the document ID)
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!documentId && attachment.name && uuidPattern.test(attachment.name)) {
            documentId = attachment.name;
            console.log(`[Attachment Fix] Extracted document ID from name: ${documentId}`);
          }
          
          // Method 3: Check if URL contains a document ID in Vercel Blob URL format
          if (!documentId && attachment.url) {
            const blobMatch = attachment.url.match(/vercel-blob\.com\/.+?\/([^\/]+)/i);
            if (blobMatch && blobMatch[1]) {
              // Don't use the full filename as a document ID
              // Instead, just log it for debugging but don't set it as documentId
              console.log(`[Attachment Fix] Found Vercel Blob URL segment: ${blobMatch[1]}, but not using as document ID`);
            }
          }
        }
        
        // Validate if the documentId is a valid UUID before querying the database
        const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId);
        
        // If we have a valid UUID as documentId, try to fetch it
        if (documentId && isValidUuid) {
          try {
            console.log(`[Attachment Fix] Looking up document metadata for valid UUID: ${documentId}`);
            const doc = await getDocumentById({ id: documentId });
            
            if (doc) {
              console.log(`[Attachment Fix] Found document:`, { 
                id: doc.id,
                fileName: doc.fileName,
                fileType: doc.fileType,
                processingStatus: doc.processingStatus
              });
              
              if (doc.fileType && doc.fileType.trim() !== '') {
                console.log(`[Attachment Fix] Using document fileType: ${doc.fileType} for attachment`);
                return { 
                  ...attachment, 
                  contentType: doc.fileType,
                  // Add name from document if attachment doesn't have one
                  name: attachment.name || doc.fileName || attachment.name
                };
              } else {
                console.log(`[Attachment Fix] Document found but has no fileType. Document:`, { 
                  id: doc.id, 
                  fileType: doc.fileType || 'undefined' 
                });
              }
            } else {
              console.log(`[Attachment Fix] No document found with ID: ${documentId}`);
            }
          } catch (error) {
            console.error(`[Attachment Fix] Error fetching document metadata:`, error);
            // Continue with basic inference if we can't fetch metadata
          }
        } else if (documentId) {
          // We have a documentId but it's not a valid UUID
          console.log(`[Attachment Fix] Extracted ID '${documentId}' is not a valid UUID format, skipping database lookup`);
        } else {
          console.log(`[Attachment Fix] Couldn't extract a document ID from attachment`);
        }
        
        // Fallback to basic inference from filename
        const filename = attachment.name?.toLowerCase() || '';
        let inferredContentType = attachment.contentType || ''; // Keep original if it existed but was empty
        
        if (!inferredContentType || inferredContentType === 'application/octet-stream') {
          console.log(`[Attachment Fix] Attempting fallback inference using filename: '${filename}'`);
          
          // More extensive MIME type inference
          if (filename.endsWith('.pdf')) {
            inferredContentType = 'application/pdf';
            console.log(`[Attachment Fix] Inferred PDF type from filename`);
          } else if (filename.endsWith('.txt')) {
            inferredContentType = 'text/plain';
            console.log(`[Attachment Fix] Inferred TXT type from filename`);
          } else if (filename.endsWith('.docx')) {
            inferredContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            console.log(`[Attachment Fix] Inferred DOCX type from filename`);
          } else if (filename.endsWith('.doc')) {
            inferredContentType = 'application/msword';
            console.log(`[Attachment Fix] Inferred DOC type from filename`);
          } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
            inferredContentType = 'image/jpeg';
            console.log(`[Attachment Fix] Inferred JPEG type from filename`);
          } else if (filename.endsWith('.png')) {
            inferredContentType = 'image/png';
            console.log(`[Attachment Fix] Inferred PNG type from filename`);
          } else if (filename.endsWith('.gif')) {
            inferredContentType = 'image/gif';
            console.log(`[Attachment Fix] Inferred GIF type from filename`);
          } else if (filename.endsWith('.svg')) {
            inferredContentType = 'image/svg+xml';
            console.log(`[Attachment Fix] Inferred SVG type from filename`);
          } else if (filename.endsWith('.webp')) {
            inferredContentType = 'image/webp';
            console.log(`[Attachment Fix] Inferred WEBP type from filename`);
          } else if (filename.endsWith('.xlsx')) {
            inferredContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            console.log(`[Attachment Fix] Inferred XLSX type from filename`);
          } else if (filename.endsWith('.xls')) {
            inferredContentType = 'application/vnd.ms-excel';
            console.log(`[Attachment Fix] Inferred XLS type from filename`);
          } else if (filename.endsWith('.csv')) {
            inferredContentType = 'text/csv';
            console.log(`[Attachment Fix] Inferred CSV type from filename`);
          } else if (filename.endsWith('.pptx')) {
            inferredContentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
            console.log(`[Attachment Fix] Inferred PPTX type from filename`);
          } else if (filename.endsWith('.ppt')) {
            inferredContentType = 'application/vnd.ms-powerpoint';
            console.log(`[Attachment Fix] Inferred PPT type from filename`);
          } else if (filename.endsWith('.md')) {
            inferredContentType = 'text/markdown';
            console.log(`[Attachment Fix] Inferred MD type from filename`);
          } else if (filename.endsWith('.html') || filename.endsWith('.htm')) {
            inferredContentType = 'text/html';
            console.log(`[Attachment Fix] Inferred HTML type from filename`);
          } else if (filename.endsWith('.json')) {
            inferredContentType = 'application/json';
            console.log(`[Attachment Fix] Inferred JSON type from filename`);
          } else if (filename.endsWith('.xml')) {
            inferredContentType = 'application/xml';
            console.log(`[Attachment Fix] Inferred XML type from filename`);
          } else if (attachment.url?.includes('.png')) {
            inferredContentType = 'image/png';
            console.log(`[Attachment Fix] Inferred PNG type from URL`);
          } else if (attachment.url?.includes('.jpg') || attachment.url?.includes('.jpeg')) {
            inferredContentType = 'image/jpeg';
            console.log(`[Attachment Fix] Inferred JPEG type from URL`);
          } else if (attachment.url?.includes('.pdf')) {
            inferredContentType = 'application/pdf';
            console.log(`[Attachment Fix] Inferred PDF type from URL`);
          } else if (attachment.url?.includes('.docx')) {
            inferredContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            console.log(`[Attachment Fix] Inferred DOCX type from URL`);
          } else {
            // Only default to octet-stream if no specific extension matches
            inferredContentType = 'application/octet-stream';
            console.log(`[Attachment Fix] Could not infer specific type from filename, defaulting to octet-stream`);
          }
          
          // Add a check if filename was empty
          if (!filename) {
            console.warn(`[Attachment Fix] Attachment name was missing, could not infer type from extension.`);
            // Try to extract extension from URL as last resort
            if (attachment.url) {
              const urlParts = attachment.url.split('.');
              const possibleExt = urlParts.length > 1 ? urlParts[urlParts.length - 1].toLowerCase() : '';
              console.log(`[Attachment Fix] Attempting to extract extension from URL: ${possibleExt}`);
              // Only update if we found a valid extension and didn't already set a specific type
              if (possibleExt && inferredContentType === 'application/octet-stream') {
                if (possibleExt === 'pdf') inferredContentType = 'application/pdf';
                else if (possibleExt === 'docx') inferredContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                else if (possibleExt === 'xlsx') inferredContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                console.log(`[Attachment Fix] Updated content type from URL extension: ${inferredContentType}`);
              }
            }
          }
        } else {
          console.log(`[Attachment Fix] Keeping existing non-generic contentType: ${inferredContentType}`);
        }
        
        console.log(`[Attachment Fix] Final result after fallback: Name='${filename || 'N/A'}', Original='${attachment.contentType || ''}', Final='${inferredContentType}'`);
        return { ...attachment, contentType: inferredContentType };
      }));
      
      return { ...message, experimental_attachments: enhancedAttachments };
    }));
    
    console.log('[Attachment Fix] Completed attachment enhancement');
    return enhancedMessages;
  } catch (error) {
    console.error('[Attachment Fix] Error enhancing attachments with metadata:', error);
    // Fall back to basic inference for filenames
    return messages.map(message => {
      if (!message.experimental_attachments || message.experimental_attachments.length === 0) {
        return message;
      }
      const fixedAttachments = message.experimental_attachments.map(attachment => {
        if (attachment.contentType && 
            attachment.contentType.trim() !== '' && 
            attachment.contentType !== 'application/octet-stream') {
          return attachment;
        }
        
        const filename = attachment.name?.toLowerCase() || '';
        let inferredContentType = attachment.contentType || '';
        
        if (!inferredContentType || inferredContentType === 'application/octet-stream') {
          console.log(`[Attachment Fix] Emergency fallback inference for: ${filename}`);
          if (filename.endsWith('.pdf')) inferredContentType = 'application/pdf';
          else if (filename.endsWith('.txt')) inferredContentType = 'text/plain';
          else if (filename.endsWith('.docx')) inferredContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          else if (filename.endsWith('.xlsx')) inferredContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          else if (filename.endsWith('.csv')) inferredContentType = 'text/csv';
          else if (filename.endsWith('.md')) inferredContentType = 'text/markdown';
          else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) inferredContentType = 'image/jpeg';
          else if (filename.endsWith('.png')) inferredContentType = 'image/png';
          else if (attachment.url?.includes('.docx')) inferredContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          else if (attachment.url?.includes('.pdf')) inferredContentType = 'application/pdf';
          else inferredContentType = 'application/octet-stream';
        }
        
        console.log(`[Attachment Fix] Emergency fallback result: Name='${filename || 'N/A'}', OriginalType='${attachment.contentType || ''}', FinalType='${inferredContentType}'`);
        return { ...attachment, contentType: inferredContentType };
      });
      return { ...message, experimental_attachments: fixedAttachments };
    });
  }
}

// Function to format search results into structured context
function formatSearchResultsAsContext(searchResults: any): string {
  if (!searchResults || !searchResults.results || !Array.isArray(searchResults.results) || searchResults.results.length === 0) {
    return '';
  }
  
  let webContextText = 'WEB SEARCH CONTEXT:\n\n';
  
  searchResults.results.forEach((result: any, index: number) => {
    if (!result) return;
    
    webContextText += `Source ${index + 1}: ${result.title || 'Untitled'} (${result.url || 'No URL'})\n`;
    webContextText += `Content: ${result.content || 'No content available'}\n\n`;
  });
  
  return webContextText;
}

export async function POST(request: Request) {
  // Start timing the entire POST handler
  console.time('total_request_duration');
  console.log("=== API route POST handler started ===");
  const requestStartTime = Date.now();
  
  try {
    console.log("API route POST handler invoked");
    console.time('parse_request');
    const {
      id,
      messages: originalMessages,
      selectedChatModel,
    }: {
      id: string;
      messages: Array<UIMessage>;
      selectedChatModel: string;
    } = await request.json();
    console.timeEnd('parse_request');

    console.log("Request parsed: ", { id, messageCount: originalMessages.length, selectedChatModel });

    // Enhanced attachment processing with metadata from database
    console.time('enhance_attachments');
    const messages = await enhanceAttachmentsWithMetadata(originalMessages);
    console.timeEnd('enhance_attachments');

    console.time('authenticate_user');
    const session = await auth();
    console.timeEnd('authenticate_user');

    if (!session || !session.user || !session.user.id) {
      console.log("Authentication failed: User not authenticated");
      console.timeEnd('total_request_duration');
      return new Response('Unauthorized', { status: 401 });
    }

    console.log("Authentication successful: User ID", session.user.id);

    const userMessage = getMostRecentUserMessage(messages);

    if (!userMessage) {
      console.log("No user message found in the request");
      console.timeEnd('total_request_duration');
      return new Response('No user message found', { status: 400 });
    }

    console.log("User message found", userMessage.id);

    // Special handling for EchoTango Reasoning Bit
    if (selectedChatModel === 'echotango-reasoning-bit') {
      // Check for 'show CoR' trigger
      if (userMessage.parts[0] && 
          'text' in userMessage.parts[0] && 
          userMessage.parts[0].text.trim().toLowerCase() === 'show cor') {
        console.log("'show CoR' trigger detected for EchoTango Reasoning Bit");
        
        // Get the last assistant message to retrieve its CoR state
        // Find the most recent assistant message before the current user message
        let lastAssistantMessage = null;
        for (let i = messages.length - 2; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            lastAssistantMessage = messages[i];
            break;
          }
        }
        
        if (lastAssistantMessage) {
          // Try to get the full message with CoR state from the database
          try {
            // getMessageById returns an array
            const dbMessages = await getMessageById({ id: lastAssistantMessage.id });
            const dbMessage = dbMessages[0]; // Access the first element of the array

            if (dbMessage && dbMessage.corState) {
              console.log("Retrieved CoR state from database for message:", lastAssistantMessage.id);
              
              // Create a response with formatted CoR state
              const formattedCorState = JSON.stringify(dbMessage.corState, null, 2);
              
              // Save the user's 'show CoR' message
              await saveMessages({
                messages: [
                  {
                    chatId: id,
                    id: userMessage.id,
                    role: 'user',
                    parts: userMessage.parts,
                    attachments: userMessage.experimental_attachments ?? [],
                    createdAt: new Date(),
                    corState: null,
                    metadata: null
                  },
                ],
              });
              
              // Generate a response showing the CoR state
              const responseId = generateUUID();
              const responseText = `\`\`\`json\n${formattedCorState}\n\`\`\``;
              
              // Save the response to the database
              await saveMessages({
                messages: [
                  {
                    chatId: id,
                    id: responseId,
                    role: 'assistant',
                    parts: [{ type: 'text', text: responseText }],
                    attachments: [],
                    createdAt: new Date(),
                    corState: null,
                    metadata: null
                  },
                ],
              });
              
              // Return a data stream response with just the formatted CoR state
              return createDataStreamResponse({
                execute: (dataStream) => {
                  const result = streamText({
                    model: myProvider.languageModel(selectedChatModel),
                    system: "Just return the exact text provided, nothing more.",
                    messages: [{ role: 'user', content: responseText }],
                    experimental_generateMessageId: () => responseId,
                  });
                  
                  result.consumeStream();
                  result.mergeIntoDataStream(dataStream);
                },
              });
            } else {
              console.log("No CoR state found for last assistant message");
              
              // Return a simple response if no CoR state found
              return createDataStreamResponse({
                execute: (dataStream) => {
                  const result = streamText({
                    model: myProvider.languageModel(selectedChatModel),
                    system: "Just return the exact text provided, nothing more.",
                    messages: [{ role: 'user', content: "No previous reasoning state found." }],
                    experimental_generateMessageId: generateUUID,
                  });
                  
                  result.consumeStream();
                  result.mergeIntoDataStream(dataStream);
                },
              });
            }
          } catch (error) {
            console.error("Error retrieving CoR state:", error);
            
            // Return an error response
            return createDataStreamResponse({
              execute: (dataStream) => {
                const result = streamText({
                  model: myProvider.languageModel(selectedChatModel),
                  system: "Just return the exact text provided, nothing more.",
                  messages: [{ role: 'user', content: "Error retrieving previous reasoning state." }],
                  experimental_generateMessageId: generateUUID,
                });
                
                result.consumeStream();
                result.mergeIntoDataStream(dataStream);
              },
            });
          }
        } else {
          console.log("No previous assistant message found");
          
          // Return a simple response if no previous assistant message
          return createDataStreamResponse({
            execute: (dataStream) => {
              const result = streamText({
                model: myProvider.languageModel(selectedChatModel),
                system: "Just return the exact text provided, nothing more.",
                messages: [{ role: 'user', content: "No previous assistant message found." }],
                experimental_generateMessageId: generateUUID,
              });
              
              result.consumeStream();
              result.mergeIntoDataStream(dataStream);
            },
          });
        }
      }
      
      // Special handling for /start command
      const isFirstMessage = messages.length === 1; // Only the current user message
      if (isFirstMessage && 
          userMessage.parts[0] && 
          'text' in userMessage.parts[0] && 
          userMessage.parts[0].text.trim().toLowerCase() === '/start') {
        console.log("/start command detected for first message with EchoTango Reasoning Bit");
        
        // Save the user's '/start' message
        await saveMessages({
          messages: [
            {
              chatId: id,
              id: userMessage.id,
              role: 'user',
              parts: userMessage.parts,
              attachments: userMessage.experimental_attachments ?? [],
              createdAt: new Date(),
              corState: null,
              metadata: null
            },
          ],
        });
        
        // Generate a response with the mandated welcome message
        const responseId = generateUUID();
        const welcomeMessage = "Hello, I am Echo Tango. What can I help you accomplish today?";
        
        // Save the welcome message with the initial CoR state
        await saveMessages({
          messages: [
            {
              chatId: id,
              id: responseId,
              role: 'assistant',
              parts: [{ type: 'text', text: welcomeMessage }],
              attachments: [],
              createdAt: new Date(),
              corState: initialCorState,
              metadata: null
            },
          ],
        });
        
        // Return a data stream response with just the welcome message
        return createDataStreamResponse({
          execute: (dataStream) => {
            const result = streamText({
              model: myProvider.languageModel(selectedChatModel),
              system: "Just return the exact text provided, nothing more.",
              messages: [{ role: 'user', content: welcomeMessage }],
              experimental_generateMessageId: () => responseId,
            });
            
            result.consumeStream();
            result.mergeIntoDataStream(dataStream);
          },
        });
      }
    }

    console.time('get_chat_data');
    const chat = await getChatById({ id });
    console.timeEnd('get_chat_data');

    if (!chat) {
      console.log("Chat not found, creating new chat");
      console.time('generate_chat_title');
      const title = await generateTitleFromUserMessage({
        message: userMessage,
      });
      console.timeEnd('generate_chat_title');

      console.time('save_new_chat');
      await saveChat({ id, userId: session.user.id, title });
      console.timeEnd('save_new_chat');
    } else {
      if (chat.userId !== session.user.id) {
        console.log("User not authorized to access this chat");
        console.timeEnd('total_request_duration');
        return new Response('Unauthorized', { status: 401 });
      }
    }

    console.log("Saving user message to database");
    console.time('save_user_message');
    await saveMessages({
      messages: [
        {
          chatId: id,
          id: userMessage.id,
          role: 'user',
          parts: userMessage.parts,
          attachments: userMessage.experimental_attachments ?? [],
          createdAt: new Date(),
          corState: null,
          metadata: null
        },
      ],
    });
    console.timeEnd('save_user_message');
    
    // Log milestone timing
    const milestone1Time = Date.now() - requestStartTime;
    console.log(`Milestone: Pre-processing completed in ${milestone1Time}ms`);

    let contextText = '';
    // Define pineconeQueryResults at a higher scope to be accessible later
    let pineconeQueryResults: any = null;
    
    if (userMessage.parts[0] && 'text' in userMessage.parts[0] && userMessage.parts[0].text) {
      try {
        const userQuery = userMessage.parts[0].text;
        console.log("Retrieving relevant document context for:", userQuery.substring(0, 100) + '...');
        
        // Time the embedding generation
        console.time('embedding_generation');
        console.log(`Starting embedding generation for query (${userQuery.length} chars)`);
        const embedding = await generateEmbeddings(userQuery);
        console.timeEnd('embedding_generation');
        console.log(`Embedding generation complete, vector length: ${embedding.length}`);
        
        // Use enhanced Pinecone diagnostic query
        console.log("Using enhanced Pinecone diagnostics");
        try {
          // Use the enhanced diagnostic query function instead of direct index query
          const INDEX_NAME = process.env.PINECONE_INDEX_NAME;
          if (!INDEX_NAME) {
            throw new Error('PINECONE_INDEX_NAME environment variable is not defined');
          }
          
          console.log(`Querying Pinecone with INDEX_NAME: ${INDEX_NAME}, userId filter: ${session.user.id}`);
          
          // Add pre-query diagnostic log
          console.log('[API Chat] Attempting to call queryPineconeWithDiagnostics...');
          
          try {
            pineconeQueryResults = await queryPineconeWithDiagnostics(
              INDEX_NAME,
              embedding,
              5,
              { userId: session.user.id }
            );
            
            if (pineconeQueryResults.matches && Array.isArray(pineconeQueryResults.matches) && pineconeQueryResults.matches.length > 0) {
              console.time('process_query_results');
              contextText = pineconeQueryResults.matches
                .map((match: any) => {
                  const text = match.metadata?.text || '';
                  const source = match.metadata?.source || 'Unknown document';
                  const score = match.score ? Math.round(match.score * 100) / 100 : 0;
                  return `[SOURCE: ${source}] (relevance: ${score})\n${text}`;
                })
                .filter((text: string) => text.length > 0)
                .join('\n\n');
              console.timeEnd('process_query_results');
              
              console.log(`Found relevant context (${contextText.length} characters)`);
              console.log(`Retrieved ${pineconeQueryResults.matches.length} relevant chunks from documents`);
            } else {
              console.log('No relevant context found in user documents');
            }
          } catch (queryError) {
            console.error('❌ [API Chat] Error executing queryPineconeWithDiagnostics:', queryError);
            // Log more details if possible
            if (queryError instanceof Error) {
              console.error(`Query Error Details: Name=${queryError.name}, Message=${queryError.message}`);
              console.error(`Stack trace: ${queryError.stack}`);
            }
            // Proceed without Pinecone context
            contextText = '';
            console.log('[API Chat] Proceeding without Pinecone context due to query error.');
          }
        } catch (pineconeError) {
          console.error('Error in Pinecone query operation:', pineconeError);
          console.log('Stack trace:', pineconeError instanceof Error ? pineconeError.stack : 'No stack trace available');
          
          // Fallback to direct index query if diagnostic version fails
          console.log('Attempting fallback to direct Pinecone query');
          console.time('pinecone_direct_query');
          try {
            const index = getPineconeIndex();
            pineconeQueryResults = await index.query({
              vector: embedding,
              topK: 5,
              filter: { userId: session.user.id },
              includeMetadata: true,
            });
            console.timeEnd('pinecone_direct_query');
            
            if (pineconeQueryResults.matches && Array.isArray(pineconeQueryResults.matches) && pineconeQueryResults.matches.length > 0) {
              contextText = pineconeQueryResults.matches
                .map((match: any) => {
                  const text = match.metadata?.text || '';
                  const source = match.metadata?.source || 'Unknown document';
                  const score = match.score ? Math.round(match.score * 100) / 100 : 0;
                  return `[SOURCE: ${source}] (relevance: ${score})\n${text}`;
                })
                .filter((text: string) => text.length > 0)
                .join('\n\n');
              
              console.log(`Fallback query successful: Found relevant context (${contextText.length} characters)`);
            } else {
              console.log('Fallback query: No relevant context found in user documents');
            }
          } catch (fallbackError) {
            console.error('Even fallback Pinecone query failed:', fallbackError);
          }
        }
      } catch (error) {
        console.error('Error retrieving RAG context:', error);
        console.log('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      }
    }
    
    // Log milestone timing
    const milestone2Time = Date.now() - requestStartTime;
    console.log(`Milestone: Document context retrieval completed in ${milestone2Time}ms`);

    console.time('prepare_prompt');
    let enhancedSystemPrompt = systemPrompt({ selectedChatModel });
    
    // Define generic queries that likely refer to a recently uploaded document
    const genericQueries = [
      'summarize',
      'summarize this',
      'summarize document',
      'summarize this document',
      'what is this about',
      'what is this document about',
      'what does this say',
      'can you explain this document',
      'what is in this file',
      'tell me about this document',
      'explain this',
      'analyze this document',
      'extract key points',
      'give me the main points',
      'tell me about it',
      'explain the content',
      'what\'s in it',
      'tldr',
      'highlight the key information',
      'review this document'
    ];
    
    // Try to identify the intended document if this appears to be a generic query
    let intendedDocumentId = '';
    let intendedDocumentName = '';
    let relevanceScore = 0;
    let contextIsRelevant = false;
    let primarySourceDocumentName = '';
    
    // Extract query text for checking if it's a generic query
    const userQueryText = userMessage.parts[0] && 'text' in userMessage.parts[0] ? 
                         userMessage.parts[0].text.toLowerCase().trim() : '';
    
    // Check if the query is a generic one likely referring to a document
    const isGenericQuery = genericQueries.some(q => 
      userQueryText === q || 
      userQueryText.startsWith(q + ' ') || 
      userQueryText.includes(q)
    );
    
    console.log(`[API Chat] Query text: "${userQueryText}"`);
    console.log(`[API Chat] Is generic document query: ${isGenericQuery}`);
    
    // Check if the most recent user message has exactly one attachment
    const recentUserMessageAttachments = userMessage.experimental_attachments;
    if (isGenericQuery && recentUserMessageAttachments && recentUserMessageAttachments.length === 1) {
      const attachment = recentUserMessageAttachments[0];
      console.log(`[API Chat] Heuristic: Message has one attachment: ${attachment.name || 'unnamed'}`);
      
      // Try to extract documentId from attachment
      // @ts-ignore - Check if documentId exists on the attachment object
      if (attachment.documentId) {
        // @ts-ignore - Use the documentId from the attachment
        intendedDocumentId = attachment.documentId;
        console.log(`[API Chat] Heuristic: Found documentId on attachment: ${intendedDocumentId}`);
      } else if (attachment.url) {
        // Extract from URL if possible
        const urlMatch = attachment.url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
        if (urlMatch && urlMatch[1]) {
          intendedDocumentId = urlMatch[1];
          console.log(`[API Chat] Heuristic: Extracted documentId from URL: ${intendedDocumentId}`);
        }
      }
      
      // Use name for reference
      intendedDocumentName = attachment.name || 'recently uploaded document';
      console.log(`[API Chat] Heuristic: Intended document name from attachment: ${intendedDocumentName}`);
    }
    
    // Only perform additional checks if we have context and identified a potential document
    if (contextText && intendedDocumentId) {
      console.log(`[API Chat] Checking relevance of context to document: ${intendedDocumentId}`);
      
      try {
        // Check if the Pinecone results contain chunks from the intended document
        if (pineconeQueryResults && pineconeQueryResults.matches && Array.isArray(pineconeQueryResults.matches)) {
          // Count matches that belong to the intended document
          const relevantMatches = pineconeQueryResults.matches.filter((match: any) => 
            match.metadata && match.metadata.documentId === intendedDocumentId
          );
          
          const relevantCount = relevantMatches.length;
          const totalMatches = pineconeQueryResults.matches.length;
          
          // Calculate a relevance score (0-100%)
          relevanceScore = totalMatches > 0 ? (relevantCount / totalMatches) * 100 : 0;
          
          // Determine if context is relevant (at least 50% of matches from intended document)
          contextIsRelevant = relevanceScore >= 50;
          
          console.log(`[API Chat] Relevance Check: ${relevantCount}/${totalMatches} matches (${relevanceScore.toFixed(1)}%) belong to intended document`);
          console.log(`[API Chat] Context is relevant to intended document: ${contextIsRelevant}`);
          
          // Get document name from metadata if available
          if (relevantMatches.length > 0 && relevantMatches[0].metadata && relevantMatches[0].metadata.source) {
            primarySourceDocumentName = relevantMatches[0].metadata.source;
            console.log(`[API Chat] Using source name from metadata: ${primarySourceDocumentName}`);
          }
        }
      } catch (error) {
        console.error('[API Chat] Error checking document relevance:', error);
      }
    }
    
    if (contextText) {
      console.log(`Context length: ${contextText.length} characters`);
      
      // Base instruction for using the context
      let contextInstructions = `Use the above context information to answer the user's question if relevant. When using information from the context, mention the source document (e.g., "According to [SOURCE NAME]"). If the context doesn't contain information relevant to the user's query, rely on your general knowledge or web search.`;
      
      // Add specific instructions based on query type and relevance
      if (isGenericQuery) {
        if (intendedDocumentId && contextIsRelevant && primarySourceDocumentName) {
          // High relevance - Add specific instruction to focus on the intended document
          contextInstructions = `IMPORTANT: The user's query refers to the document "${primarySourceDocumentName}". Please provide a comprehensive summary or analysis based on the context provided from this document. When using information from the context, mention the source document (e.g., "According to [SOURCE NAME]").`;
          console.log(`[API Chat] Added specific instruction for generic query targeting document: ${primarySourceDocumentName}`);
        } else if (intendedDocumentId && !contextIsRelevant) {
          // Low relevance but we know which document they mean - Guide the AI to handle this
          contextInstructions = `NOTE: The user appears to be asking about the document "${intendedDocumentName}", but the retrieved context may not contain sufficient information from this document. Please do your best to summarize the available context, mentioning the source document (e.g., "According to [SOURCE NAME]"). If the context isn't sufficient, politely explain that you don't have enough information about this specific document.`;
          console.log(`[API Chat] Added instruction to work with limited context for document: ${intendedDocumentName}`);
        } else {
          // Generic query but no specific document identified - Add clarification instruction
          contextInstructions = `NOTE: If unsure which document the user's generic query refers to, please ask for clarification. Use the context provided if relevant, mentioning the source document (e.g., "According to [SOURCE NAME]").`;
          console.log(`[API Chat] Added instruction to seek clarification for generic query without clear document reference`);
        }
      }
      
      enhancedSystemPrompt = `${enhancedSystemPrompt}

RELEVANT DOCUMENT CONTEXT:
${contextText}

${contextInstructions}`;
    }

    console.timeEnd('prepare_prompt');

    console.log("Creating data stream response with model:", selectedChatModel);
    console.time('stream_text_call');
    
    // Define attachments that are directly supported by the AI model
    const supportedAttachmentTypesForAI = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
      // Note: 'application/pdf' is intentionally excluded until confirmed supported
    ];
    
    // Filter messages to only include supported attachment types
    console.log('[API Chat] Filtering attachments before sending to AI model...');
    const messagesForAI = messages.map(message => {
      if (message.role === 'user' && message.experimental_attachments && message.experimental_attachments.length > 0) {
        const originalCount = message.experimental_attachments.length;
        const filteredAttachments = message.experimental_attachments.filter(att => {
          const isSupported = att.contentType && supportedAttachmentTypesForAI.includes(att.contentType);
          if (!isSupported) {
            console.log(`[API Chat] Filtering out unsupported attachment type: ${att.contentType} (Name: ${att.name || 'N/A'})`);
          }
          return isSupported;
        });
        
        const filteredCount = filteredAttachments.length;
        if (originalCount > filteredCount) {
          console.log(`[API Chat] Filtered ${originalCount - filteredCount} unsupported attachments for message ${message.id}`);
        }
        
        return {
          ...message,
          experimental_attachments: filteredAttachments
        };
      }
      // Return non-user messages or messages without attachments unmodified
      return message;
    });
    
    // Add diagnostic log to check message structure before streaming
    console.log('Messages before filtering:', JSON.stringify(
      messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        parts: msg.parts?.map(part => part.type || 'text'),
        hasAttachments: !!msg.experimental_attachments?.length,
        attachmentsCount: msg.experimental_attachments?.length || 0,
        attachments: msg.experimental_attachments?.map(att => ({
          name: att.name,
          contentType: att.contentType
        }))
      })),
      null,
      2
    ));

    console.log('Messages after filtering:', JSON.stringify(
      messagesForAI.map(msg => ({
        id: msg.id,
        role: msg.role,
        parts: msg.parts?.map(part => part.type || 'text'),
        hasAttachments: !!msg.experimental_attachments?.length,
        attachmentsCount: msg.experimental_attachments?.length || 0,
        attachments: msg.experimental_attachments?.map(att => ({
          name: att.name,
          contentType: att.contentType
        }))
      })),
      null,
      2
    ));
    
    const response = createDataStreamResponse({
      execute: async (dataStream) => {
        console.log("Streaming text from AI model");
        console.time('ai_model_streaming');
        const streamingStartTime = Date.now();
        
        // Create placeholders for context and metadata
        let documentContextText = '';
        let webContextText = '';
        let combinedContext = '';
        let responseMetadata = {};

        // Prepare context from Pinecone/RAG if available
        if (typeof contextText !== 'undefined' && contextText) {
          documentContextText = `DOCUMENT CONTEXT:\n\n${contextText}\n\n`;
          
          // Prepare metadata for Pinecone results
          if (pineconeQueryResults?.matches && pineconeQueryResults.matches.length > 0) {
            responseMetadata = {
              ...responseMetadata,
              contextSources: pineconeQueryResults.matches.map((match: any) => ({
                source: match.metadata?.source || 'Unknown document',
                content: match.metadata?.text || '',
                relevance: match.score ? Math.round(match.score * 100) / 100 : 0
              })),
              vectorIds: pineconeQueryResults.matches.map((match: any) => match.id || '')
            };
          }
        }
        
        // Check for web search results from previous tool calls
        const webSearchResults: any[] = [];
        
        // Loop through messages to find tool results from tavilySearch
        for (const msg of messages) {
          // TypeScript type guard to check for tool role message
          if ('role' in msg && 
              typeof msg.role === 'string' && 
              (msg.role as string) === 'tool' && 
              'content' in msg && 
              Array.isArray(msg.content)) {
              
            for (const content of msg.content) {
              if (
                content && 
                typeof content === 'object' && 
                'type' in content && 
                content.type === 'tool-result' && 
                'tool' in content && 
                content.tool && 
                typeof content.tool === 'object' && 
                'name' in content.tool && 
                content.tool.name === 'tavilySearch' &&
                'result' in content
              ) {
                // Get the direct result from the tool - should now be a plain string
                console.log('[API Chat] Found Tavily search result in tool response:', 
                  typeof content.result === 'string' ? content.result.substring(0, 100) + '...' : content.result);
                
                try {
                  // Handle both the new plain text format and the old structured format for backward compatibility
                  let searchInfo = {};
                  
                  // Check if the input object might have the query info
                  if (content.tool.input && typeof content.tool.input === 'object' && 'query' in content.tool.input) {
                    // Create basic metadata from the input query
                    searchInfo = {
                      original: content.tool.input.query || '',
                      enhanced: content.tool.input.query || '',
                      // This will be an empty array, but at least we'll have the query info
                      results: []
                    };
                    
                    console.log('[API Chat] Created basic metadata from tool input query:', content.tool.input.query);
                  }
                  
                  // Save to responseMetadata regardless of format to ensure we have something
                  responseMetadata = {
                    ...responseMetadata,
                    searchInfo
                  };
                  
                  console.log('[API Chat] Added search metadata to responseMetadata');
                  
                  // For context, use the text result directly
                  if (typeof content.result === 'string') {
                    webContextText = `WEB SEARCH RESULTS:\n\n${content.result}\n\n`;
                    console.log('[API Chat] Using plain text from Tavily tool response');
                  }
                } catch (error) {
                  console.error('[API Chat] Error processing Tavily result:', error);
                }
              }
            }
          }
        }
        
        // Format the most recent search result if available
        if (webSearchResults.length > 0) {
          const mostRecentSearchResult = webSearchResults[webSearchResults.length - 1];
          webContextText = formatSearchResultsAsContext(mostRecentSearchResult);
          
          // Add search results to metadata
          responseMetadata = {
            ...responseMetadata,
            searchInfo: {
              original: mostRecentSearchResult?.query?.original || '',
              enhanced: mostRecentSearchResult?.query?.enhanced || '',
              results: mostRecentSearchResult?.results || []
            }
          };
        }
        
        // Combine contexts with clear separation
        if (documentContextText || webContextText) {
          combinedContext = `${documentContextText}${webContextText ? '\n' + webContextText : ''}`;
          console.log("Added combined context to prompt");
        }
        
        // Get the standard system prompt based on selected model
        const baseSystemPrompt = typeof systemPrompt === 'function' 
          ? systemPrompt({ selectedChatModel }) 
          : systemPrompt;
        
        // --- Enhance User Query for Search ---
        let enhancedUserQuery = '';
        const userQuery = userMessage.parts[0] && 'text' in userMessage.parts[0] ? userMessage.parts[0].text : '';
        
        // Function to enhance the query
        const enhanceQuery = async () => {
          if (userQuery) {
            try {
              // Enhance the query using the current system prompt and RAG context
              const enhanced = await enhanceSearchQuery(
                  userQuery,
                  undefined, // Pass actual chat history if needed/available here
                  baseSystemPrompt, // Pass the base system prompt for context
                  contextText // Pass the retrieved RAG context
              );
              console.log(`[API Chat] Original Query: "${userQuery}"`);
              console.log(`[API Chat] Enhanced Query: "${enhanced}"`);
              return enhanced;
            } catch (error) {
              console.error('Error enhancing search query:', error);
              return '';
            }
          }
          return '';
        };
        
        // Since we're already in an async function (POST), we can await directly
        enhancedUserQuery = await enhanceQuery();
        // --- End Enhance User Query ---
        
        // Add context to system prompt if available
        let finalSystemPrompt = baseSystemPrompt;
        if (combinedContext) {
          finalSystemPrompt = `${baseSystemPrompt}\n\n${combinedContext}`;
          console.log("Enhanced system prompt with context");
        }
        
        // Add instruction for using the enhanced query with the Tavily tool
        if (userQuery && enhancedUserQuery && enhancedUserQuery !== userQuery) {
          const searchInstruction = `\n\nIMPORTANT SEARCH INSTRUCTION: If you need to use the 'tavilySearch' tool to find information about the user's latest query ('${userQuery}'), you MUST use the following optimized query instead: "${enhancedUserQuery}". Pass this optimized query as the 'query' argument to the 'tavilySearch' tool.`;
          finalSystemPrompt += searchInstruction;
          console.log("[API Chat] Added enhanced search query instruction to system prompt.");
        }
        
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: finalSystemPrompt,
          messages: messagesForAI,
          maxSteps: 5,
          experimental_activeTools: [
                  'getWeather',
                  'createDocument',
                  'updateDocument',
                  'requestSuggestions',
            'tavilySearch',
                ],
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_generateMessageId: generateUUID,
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
            tavilySearch,
          },
          onFinish: async ({ response }) => {
            const streamingDuration = Date.now() - streamingStartTime;
            console.timeEnd('ai_model_streaming');
            console.timeEnd('stream_text_call');
            console.log(`AI model streaming completed in ${streamingDuration}ms`);
            
            // Log metadata for debugging
            if (Object.keys(responseMetadata).length > 0) {
              console.log('[API Chat] Response metadata to be saved:', JSON.stringify(responseMetadata, null, 2));
            }
            
            if (session.user?.id) {
              try {
                console.time('save_assistant_message');
                const assistantId = getTrailingMessageId({
                  messages: response.messages.filter(
                    (message) => message.role === 'assistant',
                  ),
                });

                if (!assistantId) {
                  throw new Error('No assistant message found!');
                }

                const [, assistantMessage] = appendResponseMessages({
                  messages: [userMessage],
                  responseMessages: response.messages,
                });

                // Format text for all models without extracting CoR state
                if (assistantMessage && assistantMessage.parts) {
                  // Clean any text parts
                  const textPart = assistantMessage.parts.find(part => part.type === 'text');
                  if (textPart && textPart.text) {
                    // Use the formatResponse function to clean and format the text
                    const cleanedText = formatResponse(textPart.text);
                    console.log("Formatted response text");
                    
                    // Update the message part with cleaned text
                    assistantMessage.parts = assistantMessage.parts.map(part => {
                      if (part.type === 'text') {
                        return { ...part, text: cleanedText };
                      }
                      return part;
                    });
                  }
                }

                // Save the message to the database with metadata
                console.log('[VERCEL DEBUG] Metadata to be saved:', JSON.stringify(responseMetadata, null, 2));
                
                await saveMessages({
                  messages: [
                    {
                      id: assistantId,
                      chatId: id,
                      role: assistantMessage.role,
                      parts: assistantMessage.parts,
                      attachments:
                        assistantMessage.experimental_attachments ?? [],
                      createdAt: new Date(),
                      corState: null,
                      metadata: responseMetadata
                    },
                  ],
                });

                console.timeEnd('save_assistant_message');
                console.log("Assistant message saved to database");
              } catch (error) {
                console.error('Failed to save chat', error);
              }
            }
            
            const totalDuration = Date.now() - requestStartTime;
            console.timeEnd('total_request_duration');
            console.log(`=== API route POST handler completed successfully in ${totalDuration}ms ===`);
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        result.consumeStream();
        result.mergeIntoDataStream(dataStream);
      },
      onError: (error) => {
        console.error('Error in data stream:', error);
        console.log('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
        const totalDuration = Date.now() - requestStartTime;
        console.timeEnd('stream_text_call');
        console.timeEnd('total_request_duration');
        console.log(`=== API route POST handler failed within stream onError after ${totalDuration}ms ===`);
        
        // Return a string as expected by the type definition
        return 'Oops, an error occurred while processing your request. Please try again.';
      },
    });
    
    return response;
  } catch (error) {
    const totalDuration = Date.now() - requestStartTime;
    console.error('Unhandled error in POST handler:', error);
    console.log('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    console.timeEnd('total_request_duration');
    console.log(`=== API route POST handler failed with unhandled error after ${totalDuration}ms ===`);
    
    // Return a proper HTTP response for errors outside the stream
    return new Response('Oops, an error occurred while processing your request. Please try again.', { 
      status: 500 
    });
  }
}