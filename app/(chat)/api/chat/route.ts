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
import { generateEmbeddings } from '@/lib/ai/utils';
import { getPineconeIndex, queryPineconeWithDiagnostics } from '@/lib/pinecone-client';

// Set maxDuration to comply with Vercel Hobby plan limits (max 60 seconds)
export const maxDuration = 60;
export const runtime = 'nodejs';

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
        
        // Extract document ID from the URL or name field if present
        let documentId = '';
        
        // Multiple methods to extract document ID
        
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
            documentId = blobMatch[1];
            console.log(`[Attachment Fix] Extracted document ID from Vercel Blob URL: ${documentId}`);
          }
        }
        
        // Method 4: Check if URL contains another type of document identifier
        if (!documentId && attachment.url) {
          // Try to extract the last path segment which could be a document identifier
          const pathSegments = attachment.url.split('/').filter(Boolean);
          const potentialId = pathSegments[pathSegments.length - 1];
          if (potentialId && potentialId.length > 8) { // Arbitrary length check to avoid false positives
            documentId = potentialId;
            console.log(`[Attachment Fix] Extracted potential document ID from URL path: ${documentId}`);
          }
        }
        
        // If we have a potential document ID, try to fetch it
        if (documentId) {
          try {
            console.log(`[Attachment Fix] Looking up document metadata for ID: ${documentId}`);
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
        } else {
          console.log(`[Attachment Fix] Couldn't extract document ID from attachment`);
        }
        
        // Fallback to basic inference from filename
        const filename = attachment.name?.toLowerCase() || '';
        let inferredContentType = attachment.contentType || ''; // Keep original if it existed but was empty
        
        if (!inferredContentType || inferredContentType === 'application/octet-stream') {
          // More extensive MIME type inference
          if (filename.endsWith('.pdf')) inferredContentType = 'application/pdf';
          else if (filename.endsWith('.txt')) inferredContentType = 'text/plain';
          else if (filename.endsWith('.docx')) inferredContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          else if (filename.endsWith('.doc')) inferredContentType = 'application/msword';
          else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) inferredContentType = 'image/jpeg';
          else if (filename.endsWith('.png')) inferredContentType = 'image/png';
          else if (filename.endsWith('.gif')) inferredContentType = 'image/gif';
          else if (filename.endsWith('.svg')) inferredContentType = 'image/svg+xml';
          else if (filename.endsWith('.webp')) inferredContentType = 'image/webp';
          else if (filename.endsWith('.xlsx')) inferredContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          else if (filename.endsWith('.xls')) inferredContentType = 'application/vnd.ms-excel';
          else if (filename.endsWith('.csv')) inferredContentType = 'text/csv';
          else if (filename.endsWith('.pptx')) inferredContentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          else if (filename.endsWith('.ppt')) inferredContentType = 'application/vnd.ms-powerpoint';
          else if (filename.endsWith('.md')) inferredContentType = 'text/markdown';
          else if (filename.endsWith('.html') || filename.endsWith('.htm')) inferredContentType = 'text/html';
          else if (filename.endsWith('.json')) inferredContentType = 'application/json';
          else if (filename.endsWith('.xml')) inferredContentType = 'application/xml';
          else if (attachment.url?.includes('.png')) inferredContentType = 'image/png';  
          else if (attachment.url?.includes('.jpg') || attachment.url?.includes('.jpeg')) inferredContentType = 'image/jpeg';
          else if (attachment.url?.includes('.pdf')) inferredContentType = 'application/pdf';
          else inferredContentType = 'application/octet-stream'; // Last resort fallback
          
          console.log(`[Attachment Fix] Inferred content type from name/URL: ${inferredContentType}`);
        }
        
        console.log(`[Attachment Fix] Final result: Name='${filename || 'N/A'}', Original='${attachment.contentType || ''}', Final='${inferredContentType}'`);
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
          if (filename.endsWith('.pdf')) inferredContentType = 'application/pdf';
          else if (filename.endsWith('.txt')) inferredContentType = 'text/plain';
          else if (filename.endsWith('.docx')) inferredContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) inferredContentType = 'image/jpeg';
          else if (filename.endsWith('.png')) inferredContentType = 'image/png';
          else inferredContentType = 'application/octet-stream';
        }
        
        console.log(`[Attachment Fix] Emergency fallback: Name='${filename || 'N/A'}', OriginalType='${attachment.contentType || ''}', FinalType='${inferredContentType}'`);
        return { ...attachment, contentType: inferredContentType };
      });
      return { ...message, experimental_attachments: fixedAttachments };
    });
  }
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
        },
      ],
    });
    console.timeEnd('save_user_message');
    
    // Log milestone timing
    const milestone1Time = Date.now() - requestStartTime;
    console.log(`Milestone: Pre-processing completed in ${milestone1Time}ms`);

    let contextText = '';
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
            const queryResults = await queryPineconeWithDiagnostics(
              INDEX_NAME,
              embedding,
              5,
              { userId: session.user.id }
            );
            
            if (queryResults.matches && Array.isArray(queryResults.matches) && queryResults.matches.length > 0) {
              console.time('process_query_results');
              contextText = queryResults.matches
                .map(match => {
                  const text = match.metadata?.text || '';
                  const source = match.metadata?.source || 'Unknown document';
                  const score = match.score ? Math.round(match.score * 100) / 100 : 0;
                  return `[SOURCE: ${source}] (relevance: ${score})\n${text}`;
                })
                .filter(text => text.length > 0)
                .join('\n\n');
              console.timeEnd('process_query_results');
              
              console.log(`Found relevant context (${contextText.length} characters)`);
              console.log(`Retrieved ${queryResults.matches.length} relevant chunks from documents`);
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
            const queryResults = await index.query({
              vector: embedding,
              topK: 5,
              filter: { userId: session.user.id },
              includeMetadata: true,
            });
            console.timeEnd('pinecone_direct_query');
            
            if (queryResults.matches && Array.isArray(queryResults.matches) && queryResults.matches.length > 0) {
              contextText = queryResults.matches
                .map(match => {
                  const text = match.metadata?.text || '';
                  const source = match.metadata?.source || 'Unknown document';
                  const score = match.score ? Math.round(match.score * 100) / 100 : 0;
                  return `[SOURCE: ${source}] (relevance: ${score})\n${text}`;
                })
                .filter(text => text.length > 0)
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
    if (contextText) {
      console.log(`Context length: ${contextText.length} characters`);
      enhancedSystemPrompt = `${enhancedSystemPrompt}

RELEVANT DOCUMENT CONTEXT:
${contextText}

Use the above context information to answer the user's question if relevant. When using information from the context, mention the source document (e.g., "According to [SOURCE NAME]"). If the context doesn't contain information relevant to the user's query, rely on your general knowledge or web search.`;
    }
    console.timeEnd('prepare_prompt');

    console.log("Creating data stream response with model:", selectedChatModel);
    console.time('stream_text_call');
    
    // Add diagnostic log to check message structure before streaming
    console.log('Messages being sent to streamText:', JSON.stringify(
      messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        parts: msg.parts?.map(part => part.type || 'text'),
        hasAttachments: !!msg.experimental_attachments?.length,
        attachmentsCount: msg.experimental_attachments?.length || 0,
        attachments: msg.experimental_attachments?.map(att => ({
          name: att.name,
          hasContentType: !!att.contentType,
          contentType: att.contentType
        }))
      })),
      null,
      2
    ));
    
    const response = createDataStreamResponse({
      execute: (dataStream) => {
        console.log("Streaming text from AI model");
        console.time('ai_model_streaming');
        const streamingStartTime = Date.now();
        
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: enhancedSystemPrompt,
          messages,
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

        result.mergeIntoDataStream(dataStream, {
          sendReasoning: true,
        });
      },
      onError: (error) => {
        console.error('Error in data stream:', error);
        console.log('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
        const totalDuration = Date.now() - requestStartTime;
        console.timeEnd('stream_text_call');
        console.timeEnd('total_request_duration');
        console.log(`=== API route POST handler failed with error after ${totalDuration}ms ===`);
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
    return new Response('Internal Server Error', { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (!chat) {
      return new Response('Not Found', { status: 404 });
    }

    if (chat.userId !== session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    await deleteChatById({ id });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete chat', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
