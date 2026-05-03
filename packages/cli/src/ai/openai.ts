// src/ai/openai.ts
// Streams a ChatGPT response using the OpenAI SDK.

import OpenAI from 'openai';
import { Message } from '../core/session';
import { loadConfig } from '../storage/config';
import { printToken } from '../ui/print';

export async function streamOpenAI(messages: Message[]): Promise<string> {
  const config = loadConfig();
  const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'No OpenAI API key found.\n' +
      'Set it with: engram config --openai-key sk-...\n' +
      'Or set OPENAI_API_KEY in your environment.'
    );
  }

  const client = new OpenAI({ apiKey });

  const apiMessages = messages.map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  let fullText = '';

  const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: apiMessages,
    stream: true,
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || '';
    if (token) {
      printToken(token);
      fullText += token;
    }
  }

  process.stdout.write('\n');
  return fullText;
}
