export const DEFAULT_CHAT_MODEL: string = 'openai-chat-model';

interface ChatModel {
  id: string;
  name: string;
  description: string;
}

export const chatModels: Array<ChatModel> = [
  {
    id: 'openai-chat-model',
    name: 'GPT-4o Mini',
    description: 'OpenAI\'s compact multimodal model',
  },
  {
    id: 'chat-model',
    name: 'Gemini 2.5 Pro Exp',
    description: 'Google\'s advanced chat model',
  }
];
