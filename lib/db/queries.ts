'use server';

import 'server-only';

import { genSaltSync, hashSync } from 'bcrypt-ts';
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { v4 as uuidv4 } from 'uuid';

import {
  user,
  chat,
  type User,
  type Suggestion,
  suggestion,
  message,
  vote,
  type DBMessage,
  documents,
  Document,
} from './schema';
import { ArtifactKind } from '@/components/artifact';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);

export async function getUser(email: string): Promise<Array<User>> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    console.error('Failed to get user from database');
    throw error;
  }
}

export async function createUser(email: string, password: string) {
  const salt = genSaltSync(10);
  const hash = hashSync(password, salt);

  try {
    return await db.insert(user).values({ email, password: hash });
  } catch (error) {
    console.error('Failed to create user in database');
    throw error;
  }
}

export async function saveChat({
  id,
  userId,
  title,
}: {
  id: string;
  userId: string;
  title: string;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
    });
  } catch (error) {
    console.error('Failed to save chat in database');
    throw error;
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));

    return await db.delete(chat).where(eq(chat.id, id));
  } catch (error) {
    console.error('Failed to delete chat by id from database');
    throw error;
  }
}

export async function getChatsByUserId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(chat)
      .where(eq(chat.userId, id))
      .orderBy(desc(chat.createdAt));
  } catch (error) {
    console.error('Failed to get chats by user from database');
    throw error;
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    return selectedChat;
  } catch (error) {
    console.error('Failed to get chat by id from database');
    throw error;
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    console.error('Failed to save messages in database', error);
    throw error;
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    console.error('Failed to get messages by chat id from database', error);
    throw error;
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: 'up' | 'down';
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === 'up' })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === 'up',
    });
  } catch (error) {
    console.error('Failed to upvote message in database', error);
    throw error;
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    console.error('Failed to get votes by chat id from database', error);
    throw error;
  }
}

export async function saveDocument({
  id,
  userId,
  fileName,
  fileType,
  fileSize,
  blobUrl,
  processingStatus,
  statusMessage,
  totalChunks,
  processedChunks,
  content, // Keep for backward compatibility with ArtifactDocument
}: {
  id: string;
  userId: string;
  fileName: string;
  fileType: string;
  fileSize: number | string; // Accept both for backward compatibility
  blobUrl: string;
  processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  statusMessage?: string;
  totalChunks?: number;
  processedChunks?: number;
  content?: string; // Not stored in DB, but kept for compatibility
}) {
  try {
    console.log('saveDocument called with:', { 
      id, userId, fileName, fileType,
      fileSize: typeof fileSize === 'string' ? fileSize : fileSize.toString(),
      blobUrl: blobUrl?.substring(0, 30) + '...', // Truncate for logging
      processingStatus, statusMessage, totalChunks, processedChunks,
      contentLength: content ? content.length : 0,
    });
    
    // Convert fileSize to number if it's a string
    const fileSizeNumber = typeof fileSize === 'string' ? parseInt(fileSize, 10) : fileSize;
    
    const [insertedDocument] = await db.insert(documents).values({
      id,
      userId,
      fileName,
      fileType,
      fileSize: fileSizeNumber,
      blobUrl,
      processingStatus: processingStatus ?? 'pending',
      statusMessage,
      totalChunks,
      processedChunks: processedChunks ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    
    console.log('Document successfully saved to database. ID:', id);
    return insertedDocument;
  } catch (error) {
    console.error('Failed to save document in database.');
    // Safe conversion for logging only
    const err = error as Error;
    if (err.message) console.error('Error message:', err.message);
    if (err.stack) console.error('Error stack:', err.stack);
    throw error;
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documentsResult = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .orderBy(asc(documents.createdAt));

    return documentsResult;
  } catch (error) {
    console.error('Failed to get document by id from database');
    throw error;
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id));
    
    return document;
  } catch (error) {
    console.error('Error getting document by id:', error);
    return null;
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp),
        ),
      );

    return await db
      .delete(documents)
      .where(and(eq(documents.id, id), gt(documents.createdAt, timestamp)));
  } catch (error) {
    console.error(
      'Failed to delete documents by id after timestamp from database',
    );
    throw error;
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Array<Suggestion>;
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    console.error('Failed to save suggestions in database');
    throw error;
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (error) {
    console.error(
      'Failed to get suggestions by document version from database',
    );
    throw error;
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    console.error('Failed to get message by id from database');
    throw error;
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (error) {
    console.error(
      'Failed to delete messages by id after timestamp from database',
    );
    throw error;
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    console.error('Failed to update chat visibility in database');
    throw error;
  }
}

export async function getDocumentsByUserId({ userId }: { userId: string }) {
  try {
    return await db
      .select()
      .from(documents)
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.createdAt));
  } catch (error) {
    console.error('Failed to get documents by user id from database');
    throw error;
  }
}

export async function updateDocumentProcessingStatus({
  id,
  processingStatus,
}: {
  id: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
}) {
  try {
    return await db
      .update(documents)
      .set({ processingStatus })
      .where(eq(documents.id, id));
  } catch (error) {
    console.error('Failed to update document processing status in database');
    throw error;
  }
}

export async function addUploadedFileMetadata({
  id,
  userId,
  fileName,
  fileType,
  fileUrl,
  fileSize,
}: {
  id: string;
  userId: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  fileSize: string;
}) {
  try {
    console.log('addUploadedFileMetadata called with:', { 
      id, userId, fileName, fileType, fileSize, 
      fileUrl: fileUrl?.substring(0, 30) + '...' // Log truncated URL for privacy/brevity
    });
    
    const result = await db.insert(documents).values({
      id,
      userId,
      fileName,
      fileType,
      fileUrl,
      fileSize,
      title: fileName, // Use the fileName as the title
      kind: 'text', // Default kind for RAG documents
      processingStatus: 'pending', // Initial status for RAG processing
      createdAt: new Date(),
    });
    
    console.log('Document metadata successfully saved to database. Result:', result);
    return result;
  } catch (error) {
    console.error('Failed to add uploaded file metadata to database.');
    // Safe conversion for logging only
    const err = error as Error;
    if (err.message) console.error('Error message:', err.message);
    if (err.stack) console.error('Error stack:', err.stack);
    throw error;
  }
}

export async function updateFileRagStatus({
  id,
  processingStatus,
  statusMessage,
  totalChunks,
}: {
  id: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  statusMessage?: string;
  totalChunks?: number;
}) {
  try {
    console.log(`updateFileRagStatus: Updating document ${id} to status ${processingStatus}${statusMessage ? ' with message' : ''}`);
    
    const values: any = {
      processingStatus,
      updatedAt: new Date(),
    };
    
    if (statusMessage) {
      values.statusMessage = statusMessage;
    }

    if (totalChunks !== undefined) {
      values.totalChunks = totalChunks;
    }
    
    const [updatedDocument] = await db
      .update(documents)
      .set(values)
      .where(eq(documents.id, id))
      .returning();
    
    console.log(`RAG status update completed for document ${id}`);
    return updatedDocument;
  } catch (error) {
    console.error(`Failed to update RAG status for document ${id}.`);
    // Safe conversion for logging only
    const err = error as Error;
    if (err.message) console.error('Error message:', err.message);
    if (err.stack) console.error('Error stack:', err.stack);
    throw error;
  }
}

export async function getUserFiles({ userId }: { userId: string }) {
  try {
    console.log(`Getting files for user ${userId}`);
    const results = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.userId, userId),
          inArray(documents.kind, ['text', 'pdf', 'txt', 'docx'])
        )
      )
      .orderBy(desc(documents.createdAt));
    
    console.log(`Retrieved ${results.length} files for user ${userId}`);
    return results;
  } catch (error) {
    console.error(`Failed to get files for user ${userId}.`);
    // Safe conversion for logging only
    const err = error as Error;
    if (err.message) console.error('Error message:', err.message);
    if (err.stack) console.error('Error stack:', err.stack);
    throw error;
  }
}

export async function createDocument({ 
  userId, 
  fileName, 
  fileType,
  fileSize,
  blobUrl
}: { 
  userId: string; 
  fileName: string; 
  fileType: string;
  fileSize: number;
  blobUrl: string;
}) {
  try {
    const documentId = uuidv4();
    const [document] = await db
      .insert(documents)
      .values({
        id: documentId,
        userId,
        fileName,
        fileType,
        fileSize,
        blobUrl,
        processingStatus: 'pending',
      })
      .returning();
    
    return document;
  } catch (error) {
    console.error('Error creating document:', error);
    return null;
  }
}

export async function incrementProcessedChunks({ id }: { id: string }) {
  try {
    // Use SQL raw query to atomically increment the processedChunks count
    const [updatedDocument] = await db.execute(sql`
      UPDATE documents
      SET processed_chunks = processed_chunks + 1,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *;
    `);
    
    // Return the updated document with the new counts
    return {
      id: updatedDocument.id,
      processedChunks: updatedDocument.processed_chunks,
      totalChunks: updatedDocument.total_chunks
    };
  } catch (error) {
    console.error('Error incrementing processed chunks:', error);
    return null;
  }
}

export async function getDocumentProgress({ id }: { id: string }) {
  try {
    const [document] = await db
      .select({
        id: documents.id,
        processingStatus: documents.processingStatus,
        totalChunks: documents.totalChunks,
        processedChunks: documents.processedChunks,
        statusMessage: documents.statusMessage
      })
      .from(documents)
      .where(eq(documents.id, id));
    
    return document;
  } catch (error) {
    console.error('Error getting document progress:', error);
    return null;
  }
}

export async function getUserDocuments({
  userId,
}: {
  userId: string;
}): Promise<Document[]> {
  try {
    console.log(`Retrieving files for user ${userId}`);
    
    const results = await db
      .select()
      .from(documents)
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.createdAt));
    
    console.log(`Retrieved ${results.length} files for user ${userId}`);
    return results;
  } catch (error) {
    console.error('Failed to get documents by user id from database', error);
    throw error;
  }
}

export async function saveQueuedDocument({
  id,
  userId,
  fileName,
  fileType,
  fileSize,
  blobUrl,
}: {
  id: string;
  userId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  blobUrl: string;
}) {
  try {
    console.log(`Saving queued document ${id} for user ${userId}`);
    
    const [insertedDocument] = await db.insert(documents).values({
      id,
      userId,
      fileName,
      fileType,
      fileSize,
      blobUrl,
      processingStatus: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      processedChunks: 0
    }).returning();
    
    console.log(`Saved queued document ${id}`);
    return insertedDocument;
  } catch (error) {
    console.error('Failed to save queued document in database', error);
    throw error;
  }
}
