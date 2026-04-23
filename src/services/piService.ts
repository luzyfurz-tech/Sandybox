export interface FileInfo {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

export interface SystemInfo {
  cpuLoad: string;
  memory: {
    total: string;
    free: string;
    used: string;
  };
  platform: string;
  uptime: number;
}

class PiService {
  async getFiles(path?: string): Promise<{ path: string; files: FileInfo[] }> {
    const url = path ? `/api/local/files?path=${encodeURIComponent(path)}` : '/api/local/files';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch files');
    return response.json();
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const response = await fetch('/api/local/system');
    if (!response.ok) throw new Error('Failed to fetch system info');
    return response.json();
  }

  async executeCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
    const response = await fetch('/api/local/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, cwd }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Command execution failed');
    }
    return response.json();
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean; path: string }> {
    const response = await fetch('/api/local/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, content }),
    });
    if (!response.ok) throw new Error('Failed to write file');
    return response.json();
  }

  async readFile(filePath: string): Promise<{ content: string }> {
    const response = await fetch(`/api/local/read?path=${encodeURIComponent(filePath)}`);
    if (!response.ok) throw new Error('Failed to read file');
    return response.json();
  }

  async execCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
    const response = await fetch('/api/local/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, cwd }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Command execution failed');
    }
    return response.json();
  }

  async uploadFile(file: File, path?: string): Promise<{ success: boolean; file: any }> {
    const formData = new FormData();
    formData.append('file', file);
    const url = path ? `/api/local/upload?path=${encodeURIComponent(path)}` : '/api/local/upload';
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) throw new Error('Failed to upload file');
    return response.json();
  }

  async saveMemory(key: string, content: string): Promise<{ success: boolean }> {
    const response = await fetch('/api/local/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, content }),
    });
    if (!response.ok) throw new Error('Failed to save memory');
    return response.json();
  }

  async getMemory(key: string): Promise<{ content: string | null }> {
    const response = await fetch(`/api/local/memory/${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error('Failed to get memory');
    return response.json();
  }
}

export const piService = new PiService();
