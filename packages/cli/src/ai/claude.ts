// src/ai/claude.ts
// Streams a Claude response using the Anthropic SDK.

import Anthropic from '@anthropic-ai/sdk';
import { Message } from '../core/session';
import { loadConfig } from '../storage/config';
import { printToken } from '../ui/print';

export async function streamClaude(messages: Message[]): Promise<string> {
  const config = loadConfig();
  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      'No Anthropic API key found.\n' +
      'Set it with: engram config --anthropic-key sk-ant-...\n' +
      'Or set ANTHROPIC_API_KEY in your environment.'
    );
  }

  const client = new Anthropic({ apiKey });

  const systemMessages = messages.filter(m => m.role === 'system');
  const conversationMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const system = systemMessages.map(m => m.content).join('\n\n');

  let fullText = '';

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    ...(system ? { system } : {}),
    messages: conversationMessages,
  });

  for await (const chunk of stream) {
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      printToken(chunk.delta.text);
      fullText += chunk.delta.text;
    }
  }

  process.stdout.write('\n');
  return fullText;
}
