// src/ai/gemini.ts
// Streams a Gemini response using the Google Generative AI SDK.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Message } from '../core/session';
import { loadConfig } from '../storage/config';
import { printToken } from '../ui/print';

export async function streamGemini(messages: Message[]): Promise<string> {
  const config = loadConfig();
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'No Gemini API key found.\n' +
      'Set it with: engram config --gemini-key AI...\n' +
      'Or set GEMINI_API_KEY in your environment.'
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const systemMessages = messages.filter(m => m.role === 'system');
  const systemText = systemMessages.map(m => m.content).join('\n\n');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  const geminiMessages = conversationMessages.map((m, i) => {
    const content =
      i === 0 && systemText
        ? `${systemText}\n\n---\n\nUser: ${m.content}`
        : m.content;
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: content }],
    };
  });

  const lastMessage = geminiMessages.pop();
  if (!lastMessage) throw new Error('No messages to send');

  const chat = model.startChat({ history: geminiMessages });
  const result = await chat.sendMessageStream(lastMessage.parts[0].text);

  let fullText = '';
  for await (const chunk of result.stream) {
    const token = chunk.text();
    if (token) {
      printToken(token);
      fullText += token;
    }
  }

  process.stdout.write('\n');
  return fullText;
}
