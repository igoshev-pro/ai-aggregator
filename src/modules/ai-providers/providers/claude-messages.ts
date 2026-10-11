// Конвертация наших (OpenAI-подобных) сообщений в формат Anthropic Messages API.
// Используется провайдерами, которые отдают Claude через /messages.

type InMessage = { role: string; content: string | any[]; imageUrls?: string[] };
type ClaudeMessage = { role: string; content: string | any[] };

// Картинки идут перед текстом — так рекомендует Anthropic.
function buildClaudeContent(text: string, imageUrls?: string[]): string | any[] {
  if (!imageUrls || imageUrls.length === 0) return text;
  const parts: any[] = imageUrls.map((url) => ({
    type: 'image',
    source: { type: 'url', url },
  }));
  if (text && text.trim().length > 0) parts.push({ type: 'text', text });
  return parts;
}

const asBlocks = (content: string | any[]) =>
  Array.isArray(content) ? content : [{ type: 'text', text: content }];

export function toClaudeMessages(messages: InMessage[]): {
  system: string | null;
  messages: ClaudeMessage[];
} {
  let system: string | null = null;
  const merged: ClaudeMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((p: any) => p.type === 'text')
                .map((p: any) => p.text)
                .join('\n')
            : '';
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }

    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const content = Array.isArray(msg.content)
      ? msg.content
      : buildClaudeContent(
          typeof msg.content === 'string' ? msg.content : '',
          msg.imageUrls,
        );

    // Claude требует чередования ролей — подряд идущие сообщения склеиваем
    const prev = merged[merged.length - 1];
    if (prev && prev.role === role) {
      prev.content =
        typeof prev.content === 'string' && typeof content === 'string'
          ? `${prev.content}\n\n${content}`
          : [...asBlocks(prev.content), ...asBlocks(content)];
    } else {
      merged.push({ role, content });
    }
  }

  // Первое сообщение обязано быть от user, список не может быть пустым
  if (merged.length > 0 && merged[0].role === 'assistant') {
    merged.unshift({ role: 'user', content: '...' });
  }
  if (merged.length === 0) {
    merged.push({ role: 'user', content: 'Hello' });
  }

  return { system, messages: merged };
}
