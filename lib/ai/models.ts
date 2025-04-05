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
    id: 'echotango-bit',
    name: 'EchoTango Bit',
    description: 'Echo Tango\'s AI Assistant',
  }
];
