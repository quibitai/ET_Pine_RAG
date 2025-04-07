import type { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  primaryKey,
  foreignKey,
  boolean,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const user = pgTable('User', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  email: text('email').notNull(),
  password: varchar('password', { length: 64 }),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable('Chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  title: text('title').notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull(),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
}, (table) => ({
  userIdIdx: index('chat_userId_idx').on(table.userId)
}));

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable('Message_v2', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  parts: json('parts').notNull(),
  attachments: json('attachments').notNull(),
  corState: json('corState'),
  metadata: json('metadata'),
  createdAt: timestamp('createdAt').notNull(),
}, (table) => ({
  chatIdIdx: index('message_chatId_idx').on(table.chatId)
}));

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  'Vote_v2',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    messageId: uuid('messageId')
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean('isUpvoted').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type Vote = InferSelectModel<typeof vote>;

export const documents = pgTable('documents', {
  id: text('id').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  userId: text('userId').notNull(),
  fileName: text('fileName').notNull(),
  fileType: text('fileType').notNull(),
  fileSize: integer('fileSize').notNull(),
  blobUrl: text('blobUrl').notNull(),
  processingStatus: text('processingStatus').notNull().default('pending'),
  statusMessage: text('statusMessage'),
  totalChunks: integer('totalChunks'),
  processedChunks: integer('processedChunks').notNull().default(0),
  title: text('title'),
  folderPath: text('folderPath'),
  content: text('content'),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.createdAt] }),
  userIdIdx: index('documents_userId_idx').on(table.userId),
}));

export type Document = InferSelectModel<typeof documents>;

// Extended Document type for use with the artifact system
export interface ArtifactDocument extends Document {
  kind?: string;
}

export const suggestion = pgTable('Suggestion', {
  id: text('id').primaryKey(),
  documentId: text('documentId').notNull(),
  documentCreatedAt: timestamp('documentCreatedAt').notNull(),
  originalText: text('originalText').notNull(),
  suggestedText: text('suggestedText').notNull(),
  description: text('description'),
  isResolved: boolean('isResolved').notNull().default(false),
  userId: text('userId').notNull(),
  createdAt: timestamp('createdAt').notNull(),
}, (table) => ({
  documentFk: foreignKey({
    columns: [table.documentId, table.documentCreatedAt],
    foreignColumns: [documents.id, documents.createdAt]
  })
}));

export type Suggestion = InferSelectModel<typeof suggestion>;
