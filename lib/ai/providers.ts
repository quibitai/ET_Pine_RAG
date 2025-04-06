import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { groq } from '@ai-sdk/groq';
import { xai } from '@ai-sdk/xai';
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

// Explicitly define the model to use
const openaiModel = 'gpt-4o-mini';
const reasoningModelName = 'o3-mini'; // New model specifically for reasoning-bit

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'openai-chat-model': chatModel, // Mock for test environment
        'echotango-bit': chatModel, // Mock for EchoTango Bit
        'echotango-reasoning-bit': chatModel, // Mock for EchoTango Reasoning Bit
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'openai-chat-model': openai(openaiModel),
        'echotango-bit': openai(openaiModel),
        'echotango-reasoning-bit': openai(reasoningModelName), // Using the specialized reasoning model
        'title-model': openai(openaiModel),
        'artifact-model': openai(openaiModel),
      },
      imageModels: {
        'small-model': xai.image('grok-2-image'),
      },
    });
