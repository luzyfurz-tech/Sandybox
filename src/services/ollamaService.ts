import { Message } from 'ollama';

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message: Message;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

class OllamaService {
  private apiKey: string | null = null;
  private host: string | null = null;

  setApiKey(key: string) {
    this.apiKey = key;
  }

  setHost(host: string) {
    this.host = host;
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey || ''}`,
    };
    if (this.host) {
      headers['x-ollama-host'] = this.host;
    }
    return headers;
  }

  async fetchModels(): Promise<OllamaModel[]> {
    const response = await fetch('/api/models', {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch models');
    }

    const data = await response.json();
    return data.models || [];
  }

  async sendMessage(model: string, messages: Message[]): Promise<OllamaResponse> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }

    return await response.json();
  }

  async *sendMessageStream(model: string, messages: Message[]): AsyncGenerator<OllamaResponse> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start stream');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data;
          } catch (e) {
            console.error('Error parsing stream chunk:', e);
          }
        }
      }
    }
  }

  async webSearch(query: string): Promise<any> {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ q: query }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Web search failed');
    }
    return await response.json();
  }

  async webFetch(url: string): Promise<string> {
    const response = await fetch('/api/fetch', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Web fetch failed');
    }
    const data = await response.json();
    return data.content || '';
  }
}

export const ollamaService = new OllamaService();
