import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { groq } from '@ai-sdk/groq';
import { xai } from '@ai-sdk/xai';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { isTestEnvironment } from '../constants';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';

// Configure OpenAI embedding model for RAG (3072 dimensions to match Pinecone)
export const embeddingModel = openai('text-embedding-3-large');

// Explicitly define the models to use
const geminiModel = 'models/gemini-2.5-pro-exp-03-25';
const openaiModel = 'gpt-4o-mini';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'openai-chat-model': chatModel, // Mock for test environment
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': google(geminiModel),
        'openai-chat-model': openai(openaiModel),
        'title-model': google(geminiModel),
        'artifact-model': google(geminiModel),
      },
      imageModels: {
        'small-model': xai.image('grok-2-image'),
      },
    });
