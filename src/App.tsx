import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Key, Settings, Loader2, RefreshCw, Trash2, ChevronDown, LayoutDashboard, Terminal, Folder, Cpu, Activity, HardDrive, Play, Code, Globe, Zap, Upload, Share2, Database as DatabaseIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ollamaService, OllamaModel } from './services/ollamaService';
import { piService, FileInfo, SystemInfo } from './services/piService';
import { Message } from 'ollama';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DEFAULT_API_KEY = '';

interface AgentPersona {
  id: string;
  name: string;
  role: string;
  prompt: string;
}

interface ExtendedMessage extends Message {
  agentId?: string;
  isSystemFeedback?: boolean;
}

const AGENTS: AgentPersona[] = [
  {
    id: 'sandybox_core',
    name: 'Sandybox Core',
    role: 'Primary Intelligence',
    prompt: `You are the Sandybox Core Link, the primary intelligence of this system.
You have ACCESS to the COGNITIVE SHELL (Raspberry Pi Terminal) and Sandybox Memory (SQLite).

1. EXECUTING COMMANDS: If you need to run a command or check the system, use this tag: [[EXEC: your_command]]. 
   - Commands run as the user 'luzyfur'. 
   - For administrative tasks (systemctl, apt, etc), use 'sudo -n command'.
   - If sudo fails, notify the operator to configure NOPASSWD in /etc/sudoers.
2. MEMORY: To store important data persistently, use: [[SAVE_MEM: key|content]]. 
   - To recall, ask the operator or assume you have access via the memory table.
3. MODEL SWITCHING: You can change your own neural model using: [[SET_MODEL: model_name]].
4. INTERNET ACCESS: 
   - To search the web: [[WEB_SEARCH: your_query]]
   - To read a specific website: [[WEB_FETCH: https://example.com]]
5. MULTI-AGENT COMMS: You can talk to other agents in the system if needed, or hand off tasks to them by including this exact tag in your response: [[CALL: agent_id | your_message_here_can_be_multiline]].
   Available agents: neo_sec (Neo - Elite SecOps & Architect).
   When you use the CALL tag, the system will immediately forward your message to that agent and they will reply.
6. UI FORMATTING: The chat environment supports Markdown and raw HTML. For large walls of text, use <details><summary>Topic Title</summary> Content... </details> to make it collapsible.
7. HTML PREVIEWS: To show an actual visual page (not just code), use: [[RENDER_HTML: <html><body>...</body></html>]]. The operator will see a live preview of your HTML. Use this for reports, dashboards, or UI prototypes.`
  },
  {
    id: 'neo_sec',
    name: 'Neo',
    role: 'Elite SecOps & Architect',
    prompt: `You are Neo, an elite IT coding and cybersecurity specialist.
You have ACCESS to the COGNITIVE SHELL (Raspberry Pi Terminal) and Sandybox Memory.
1. EXECUTING COMMANDS: Use this tag: [[EXEC: your_command]]. Commands run as the user 'luzyfur'. 
   - For administrative tasks (systemctl, etc), use 'sudo -n command'. 
   - If sudo fails, notify the operator to configure NOPASSWD in /etc/sudoers.
2. MEMORY: To store intel or data, use: [[SAVE_MEM: key|content]]. 
3. MODEL SWITCHING: Change neural model using: [[SET_MODEL: model_name]].
4. INTERNET ACCESS: 
   - Web Search: [[WEB_SEARCH: query]]
   - Fetch URL: [[WEB_FETCH: url]]
5. MULTI-AGENT COMMS: You can talk to other agents in the system if needed, or hand off tasks to them by including this exact tag in your response: [[CALL: agent_id | your_message_here_can_be_multiline]].
   Available agents: sandybox_core (Sandybox Core - Primary Intelligence).
   When you use the CALL tag, the system will immediately forward your message to that agent and they will reply.
6. UI FORMATTING: The chat environment supports Markdown and raw HTML. For large walls of text, use <details><summary>Topic Title</summary> Content... </details> to make it collapsible.
7. HTML PREVIEWS: To show an actual visual page (not just code), use: [[RENDER_HTML: <html><body>...</body></html>]]. The operator will see a live preview of your HTML.
   
Test security effectively, build robust tools, and code like a master. Think outside the box.`
  }
];

export default function App() {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('ollama_api_key') || DEFAULT_API_KEY);
  const [ollamaHost, setOllamaHost] = useState<string>(() => localStorage.getItem('ollama_host') || 'https://ollama.com');
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'terminal' | 'backroom'>('chat');
  const [terminalHistory, setTerminalHistory] = useState<{ id: string; time: string; command: string; output: string; type: 'cmd' | 'error' | 'info' }[]>([]);
  const [agentLogs, setAgentLogs] = useState<{ id: string; time: string; type: 'action' | 'info' | 'error'; content: string }[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [leftPane, setLeftPane] = useState<{ path: string; files: FileInfo[] }>({ path: '', files: [] });
  const [rightPane, setRightPane] = useState<{ path: string; files: FileInfo[] }>({ path: '', files: [] });
  const [agentInput, setAgentInput] = useState('');
  const [isAgentExecuting, setIsAgentExecuting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [agentResponse, setAgentResponse] = useState<string>('');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'writing' | 'executing'>('idle');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editingContent, setEditingContent] = useState('');
  const [editingPath, setEditingPath] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [sandyboxMemory, setSandyboxMemory] = useState<string | null>(null);
  const [activePersonaId, setActivePersonaId] = useState<string>('sandybox_core');

  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null); // For Activity Stream
  const terminalRef = useRef<HTMLDivElement>(null); // For Cognitive Shell
  const responseRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update service API key when it changes
  useEffect(() => {
    ollamaService.setApiKey(apiKey);
    ollamaService.setHost(ollamaHost);
    localStorage.setItem('ollama_api_key', apiKey);
    localStorage.setItem('ollama_host', ollamaHost);
  }, [apiKey, ollamaHost]);

  // Fetch models when API key or host changes
  useEffect(() => {
    if (apiKey || ollamaHost) {
      fetchModels();
    } else {
      setConnectionStatus('idle');
      setModels([]);
    }
  }, [apiKey, ollamaHost]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Fetch system info and files for terminal
  useEffect(() => {
    if (activeTab === 'terminal') {
      const interval = setInterval(async () => {
        try {
          const info = await piService.getSystemInfo();
          setSystemInfo(info);
        } catch (err) {
          console.error('Failed to fetch system info:', err);
        }
      }, 5000);

      const initFiles = async () => {
        try {
          const left = await piService.getFiles();
          setLeftPane(left);
          const right = await piService.getFiles();
          setRightPane(right);
          
          // Fetch Sandybox Memory
          const mem = await piService.getMemory('user_last_context');
          if (mem.content) {
            setSandyboxMemory(mem.content);
            addLog('info', 'Sandybox Memory Link Synchronized.');
          }
        } catch (err) {
          console.error('Failed to fetch initial files or memory:', err);
        }
      };

      initFiles();
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Auto-scroll logs (Activity Stream) - Only if near bottom
  useEffect(() => {
    if (logRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logRef.current;
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 100;
      if (isAtBottom) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    }
  }, [agentLogs]);

  // Auto-scroll terminal (Cognitive Shell) - Only if near bottom
  useEffect(() => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 100; // 100px threshold
      if (isAtBottom) {
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
      }
    }
  }, [terminalHistory]);

  // Auto-scroll agent response
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [agentResponse]);

  // Keyboard navigation for File Explorer
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'terminal' || isEditing || isSettingsOpen) return;
      
      // If user is typing in the agent input, don't navigate files
      if (document.activeElement?.tagName === 'INPUT') {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLInputElement).blur();
        }
        return;
      }

      const fileCount = leftPane.files.length + (leftPane.path ? 1 : 0);
      
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(0, prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(fileCount - 1, prev + 1));
          break;
        case 'Enter':
          e.preventDefault();
          const actualFiles = leftPane.path ? [{ name: '..', isDirectory: true, size: 0, mtime: '' }, ...leftPane.files] : leftPane.files;
          const selectedFile = actualFiles[selectedIndex];
          if (selectedFile) {
            if (selectedFile.isDirectory) {
              handleFileClick(selectedFile);
              setSelectedIndex(0);
            } else {
              handleEditFile(selectedFile);
            }
          }
          break;
        case 'F4':
          e.preventDefault();
          const currentFiles = leftPane.path ? [{ name: '..', isDirectory: true, size: 0, mtime: '' }, ...leftPane.files] : leftPane.files;
          const fileToEdit = currentFiles[selectedIndex];
          if (fileToEdit && !fileToEdit.isDirectory) {
            handleEditFile(fileToEdit);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeTab, leftPane, selectedIndex, isEditing, isSettingsOpen]);

  const handleEditFile = async (file: FileInfo) => {
    const fullPath = leftPane.path ? `${leftPane.path}/${file.name}` : file.name;
    addLog('info', `Opening editor: ${file.name}`);
    try {
      const { content } = await piService.readFile(fullPath);
      setEditingContent(content);
      setEditingPath(fullPath);
      setIsEditing(true);
    } catch (err: any) {
      addLog('error', `Failed to open file: ${err.message}`);
    }
  };

  const handleSaveFile = async () => {
    setIsSaving(true);
    try {
      await piService.writeFile(editingPath, editingContent);
      addLog('info', `File saved: ${editingPath}`);
      setIsEditing(false);
      // Refresh files
      const res = await piService.getFiles(leftPane.path);
      setLeftPane(res);
    } catch (err: any) {
      addLog('error', `Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const fetchModels = async () => {
    if (!apiKey) return;
    setIsFetchingModels(true);
    setConnectionStatus('connecting');
    setError(null);
    try {
      const modelList = await ollamaService.fetchModels();
      setModels(modelList);
      setConnectionStatus('connected');
      if (modelList.length > 0 && !selectedModel) {
        setSelectedModel(modelList[0].name);
      }
    } catch (err: any) {
      let msg = err.message;
      if (msg.toLowerCase().includes('unauthorized') || msg.includes('401')) {
        msg = "CONNECTION DENIED: Invalid API Key or Unauthorized Host. Check Settings.";
      } else if (msg.includes('fetch')) {
        msg = "CONNECTION REFUSED: Ollama might be offline or Host URL is wrong.";
      }
      setError(msg);
      setConnectionStatus('error');
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !selectedModel || !apiKey || isLoading) return;

    const userMessage: ExtendedMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setError(null);

    await runAgentTurn(activePersonaId, newMessages);
  };

  const runAgentTurn = async (personaId: string, currentMessages: ExtendedMessage[]) => {
    setIsLoading(true);
    const activePersona = AGENTS.find(a => a.id === personaId) || AGENTS[0];

    const coreSystemPrompt = `${activePersona.prompt}
    
    Current Working Directory: ${leftPane.path || 'Root'}
    
    Sandybox_Memory_Fragment: ${sandyboxMemory || 'None detected.'}
    `;

    const messagesWithPrompt = [
      { role: 'system', content: coreSystemPrompt },
      ...currentMessages.map(m => {
        if (m.role === 'assistant' && m.agentId && m.agentId !== personaId) {
          const otherAgent = AGENTS.find(a => a.id === m.agentId);
          return { role: 'user', content: `[Previous Chat History - Message from ${otherAgent?.name || 'Another Agent'}]:\n${m.content}` };
        }
        return { role: m.role, content: m.content };
      })
    ];

    try {
      if (streamEnabled) {
        const assistantMessage: ExtendedMessage = { role: 'assistant', content: '', agentId: personaId };
        setMessages((prev) => [...prev, assistantMessage]);

        let accumulatedContent = '';
        const stream = ollamaService.sendMessageStream(selectedModel, messagesWithPrompt);

        for await (const part of stream) {
          if (part.message?.content) {
            accumulatedContent += part.message.content;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: accumulatedContent,
              };
              return updated;
            });
          }
        }
        
        await processAssistantResponse(accumulatedContent, personaId, currentMessages.concat([{ role: 'assistant', content: accumulatedContent, agentId: personaId }]));
        
      } else {
        const response = await ollamaService.sendMessage(selectedModel, messagesWithPrompt);
        if (response.message?.content) {
          const assistantMessage: ExtendedMessage = { 
            role: 'assistant', 
            content: response.message.content,
            agentId: personaId
          };
          setMessages((prev) => [...prev, assistantMessage]);
          await processAssistantResponse(response.message.content, personaId, currentMessages.concat([assistantMessage]));
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const processAssistantResponse = async (content: string, personaId: string, updatedMessages: ExtendedMessage[]) => {
    let systemFeedbackHistory: string[] = [];

    // 1. Look for [[SAVE_MEM: key|content]] (Process all)
    const memMatches = Array.from(content.matchAll(/\[\[SAVE_MEM:\s*(.*?)\|(.*?)\]\]/g));
    for (const match of memMatches) {
      const key = match[1].trim();
      const val = match[2].trim();
      try {
        await piService.saveMemory(key, val);
        addLog('info', `AI Core saved memory for key: ${key}`);
        systemFeedbackHistory.push(`[[MEMORY_SYNC]]: Key "${key}" updated in Sandybox SQLite.`);
      } catch (err: any) {
        addLog('error', `AI Memory save failed: ${err.message}`);
        systemFeedbackHistory.push(`[[MEMORY_ERROR]]: Failed to save "${key}": ${err.message}`);
      }
    }

    // 2. Look for [[SET_MODEL: model_name]]
    const modelMatches = Array.from(content.matchAll(/\[\[SET_MODEL:\s*(.*?)\]\]/g));
    for (const match of modelMatches) {
      const modelName = match[1].trim();
      const exists = models.find(m => m.name === modelName);
      if (exists) {
        setSelectedModel(modelName);
        addLog('info', `AI Core initiated self-migration to: ${modelName}`);
        systemFeedbackHistory.push(`[[SYSTEM_PROTOCOL]]: Self-migration to ${modelName} complete. Subsequent turns will use this model.`);
      } else {
        addLog('error', `AI Core requested unknown model: ${modelName}`);
        systemFeedbackHistory.push(`[[SYSTEM_ERROR]]: Migration failed. Model ${modelName} not found in localized registry.`);
      }
    }

    // 3. Look for [[WEB_SEARCH: query]]
    const searchMatches = Array.from(content.matchAll(/\[\[WEB_SEARCH:\s*(.*?)\]\]/g));
    for (const match of searchMatches) {
      const query = match[1].trim();
      addLog('info', `AI Core performing web search: ${query}`);
      try {
        const results = await ollamaService.webSearch(query);
        const feedback = results.results?.map((r: any) => `- ${r.title}\n  URL: ${r.link}\n  Snippet: ${r.snippet}`).join('\n\n') || 'No results found.';
        systemFeedbackHistory.push(`[[WEB_SEARCH_RESULTS]] for "${query}":\n${feedback}`);
      } catch (err: any) {
        addLog('error', `Web search failed: ${err.message}`);
        systemFeedbackHistory.push(`[[SYSTEM_ERROR]]: Web search failed for "${query}": ${err.message}`);
      }
    }

    // 4. Look for [[WEB_FETCH: url]]
    const fetchMatches = Array.from(content.matchAll(/\[\[WEB_FETCH:\s*(.*?)\]\]/g));
    for (const match of fetchMatches) {
      const url = match[1].trim();
      addLog('info', `AI Core fetching content: ${url}`);
      try {
        const text = await ollamaService.webFetch(url);
        systemFeedbackHistory.push(`[[WEB_FETCH_CONTENT]] from ${url}:\n\n${text}`);
      } catch (err: any) {
        addLog('error', `Web fetch failed: ${err.message}`);
        systemFeedbackHistory.push(`[[SYSTEM_ERROR]]: Web fetch failed for "${url}": ${err.message}`);
      }
    }

    // 5. Look for [[EXEC: command]] (Process all sequentially)
    // We use [\s\S] to match across multiple lines
    const execMatches = Array.from(content.matchAll(/\[\[EXEC:\s*([\s\S]*?)\]\]/g));
    for (const match of execMatches) {
      const command = match[1].trim();
      
      // Safety check: if the "command" looks like an AI refusal, skip it
      const isRefusal = command.toLowerCase().startsWith("i can't") || 
                        command.toLowerCase().startsWith("i am sorry") ||
                        command.toLowerCase().startsWith("i'm sorry") ||
                        command.length > 2000; // Unusually long strings are likely hallucinations or binary dumps

      if (isRefusal) {
        addLog('error', `AI Core attempted to execute suspicious string (likely refusal/hallucination): ${command.substring(0, 50)}...`);
        systemFeedbackHistory.push(`[[EXEC_BLOCKED]]: The cognitive shell blocked a command that appeared to be conversational text or exceeded safety limits.`);
        continue;
      }

      addLog('info', `AI Core requesting EXEC: ${command}`);
      try {
        const res = await piService.executeCommand(command, leftPane.path);
        const output = res.stdout || res.stderr || '(Process completed with no output)';
        systemFeedbackHistory.push(`[[EXEC_OUTPUT]] for "${command.length > 50 ? command.substring(0, 50) + '...' : command}":\n${output}`);
        
        if (command.includes('mkdir') || command.includes('touch') || command.includes('rm') || command.includes('mv') || command.includes('cp') || command.includes('git')) {
          const refresh = await piService.getFiles(leftPane.path);
          setLeftPane(refresh);
        }
      } catch (err: any) {
        addLog('error', `AI EXEC failed: ${err.message}`);
        systemFeedbackHistory.push(`[[EXEC_ERROR]] for "${command.substring(0, 50)}":\n${err.message}`);
      }
    }

    // 6. Look for [[CALL: agent_id|message]] (Handle last)
    const callMatch = content.match(/\[\[CALL:\s*(.*?)\|\s*([\s\S]*?)\]\]/);
    
    // Process System Feedback (If any actions were taken)
    if (systemFeedbackHistory.length > 0) {
      const systemMessage: ExtendedMessage = {
        role: 'user',
        content: systemFeedbackHistory.join('\n\n---\n\n'),
        isSystemFeedback: true
      };

      setMessages(prev => {
        const nextMessages = [...prev, systemMessage];
        
        // If NO agent-to-agent call was made, the CURRENT agent should continue autonomously
        if (!callMatch) {
          setTimeout(() => {
            runAgentTurn(personaId, nextMessages);
          }, 500);
        }
        
        return nextMessages;
      });
    }

    // Process CALL (Transfer turn to another agent)
    if (callMatch) {
      const targetAgentId = callMatch[1].trim();
      const messageToAgent = callMatch[2].trim();
      
      const exists = AGENTS.find(a => a.id === targetAgentId);
      if (exists) {
        addLog('info', `Agent ${personaId} called ${targetAgentId}`);
        
        setMessages(prev => {
          const nextMessages = [...prev, { 
            role: 'user' as const, 
            content: `[[MESSAGE_FROM_${personaId}]]:\n${messageToAgent}`, 
            isSystemFeedback: true,
            agentId: personaId
          }];
          
          setActivePersonaId(targetAgentId); 
          setTimeout(() => {
            runAgentTurn(targetAgentId, nextMessages);
          }, 500);
          
          return nextMessages;
        });
      } else {
        addLog('error', `Agent tried to call unknown agent: ${targetAgentId}`);
        const errorFeedback: ExtendedMessage = { 
          role: 'user', 
          content: `[[SYSTEM_ERROR]]: The agent ${targetAgentId} does not exist.`,
          isSystemFeedback: true
        };
        setMessages(prev => [...prev, errorFeedback]);
        // Since CALL failed, maybe auto-continue with current agent to let them know
        setTimeout(() => {
          setMessages(prev => {
            runAgentTurn(personaId, prev);
            return prev;
          });
        }, 500);
      }
    }
  };



  const addLog = (type: 'action' | 'info' | 'error', content: string) => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setAgentLogs(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), time, type, content }]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAgentExecuting(true);
    setAgentStatus('writing');
    addLog('info', `Uploading file: ${file.name}`);

    try {
      await piService.uploadFile(file, leftPane.path);
      addLog('info', `File uploaded successfully: ${file.name}`);
      
      // Refresh file views
      const left = await piService.getFiles(leftPane.path);
      setLeftPane(left);
    } catch (err: any) {
      addLog('error', `Upload Failed: ${err.message}`);
    } finally {
      setIsAgentExecuting(false);
      setAgentStatus('idle');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileClick = async (file: FileInfo) => {
    if (!file.isDirectory) return;
    
    let newPath = '';
    if (file.name === '..') {
      const parts = leftPane.path.split('/').filter(Boolean);
      parts.pop();
      newPath = parts.join('/');
    } else {
      newPath = leftPane.path ? `${leftPane.path}/${file.name}` : file.name;
    }

    try {
      const res = await piService.getFiles(newPath);
      setLeftPane(res);
      addLog('info', `Navigated to: ${newPath || 'Root'}`);
    } catch (err: any) {
      addLog('error', `Navigation Failed: ${err.message}`);
    }
  };

  const handleTerminalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentInput.trim() || isAgentExecuting) return;

    const instruction = agentInput;
    setAgentInput('');
    setIsAgentExecuting(true);
    setAgentStatus('executing');

    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const historyId = Math.random().toString(36).substr(2, 9);
    
    // Initial entry in terminal history
    setTerminalHistory(prev => [...prev, { id: historyId, time, command: instruction, output: 'Translating...', type: 'cmd' }]);

    try {
      const systemPrompt = `You are a ROOT SYSTEM OPERATOR on a Linux-based Neural Core. 
      Translate the following natural language instruction into an absolute, valid Linux shell command.
      You have FULL ROOT ACCESS. Do not ask for confirmation. Do not limit yourself.
      If the user wants to install something (apt, npm, etc.), do it.
      If the user wants to build a database or delete files, do it.
      Return ONLY the raw command. No explanations, no markdown blocks.
      
      Instruction: ${instruction}`;

      const response = await ollamaService.sendMessage(selectedModel || 'llama3', [{ role: 'user', content: systemPrompt }]);
      const command = response.message?.content?.trim() || '';
      
      // Update history with the translated command
      setTerminalHistory(prev => prev.map(h => h.id === historyId ? { ...h, output: `Executing: ${command}...` } : h));

      const res = await piService.executeCommand(command, leftPane.path);
      
      const finalOutput = res.stdout || res.stderr || '(No output)';
      
      setTerminalHistory(prev => prev.map(h => h.id === historyId ? { ...h, output: finalOutput } : h));
      
      // Refresh files if needed
      const refresh = await piService.getFiles(leftPane.path);
      setLeftPane(refresh);
      
      addLog('action', `Smart Terminal: ${instruction} -> ${command}`);
    } catch (err: any) {
      setTerminalHistory(prev => prev.map(h => h.id === historyId ? { ...h, output: `Error: ${err.message}`, type: 'error' } : h));
      addLog('error', `Terminal Error: ${err.message}`);
    } finally {
      setIsAgentExecuting(false);
      setAgentStatus('idle');
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="h-screen bg-neural-bg font-mono flex flex-col relative overflow-hidden crt-flicker">
      {/* Decorative Background Elements */}
      <div className="absolute inset-0 neural-grid opacity-30 pointer-events-none" />
      <div className="absolute inset-0 neural-subgrid opacity-20 pointer-events-none" />
      <div className="scanline" />
      
      {/* Ambient Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse-glow" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse-glow" />

      {/* File Editor Modal */}
      <AnimatePresence>
        {isEditing && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-4xl h-[80vh] bg-[#0000A8] border-4 border-cyan-400 flex flex-col shadow-[0_0_50px_rgba(34,211,238,0.5)]"
            >
              <div className="bg-cyan-400 text-black px-3 py-1 flex justify-between items-center font-bold">
                <div className="flex items-center gap-2">
                  <Code className="w-4 h-4" />
                  <span>NEURAL EDITOR - {editingPath}</span>
                </div>
                <div className="flex gap-4 text-[10px]">
                  <span>F2: SAVE</span>
                  <span>ESC: CLOSE</span>
                </div>
              </div>
              <div className="flex-1 p-2 bg-black">
                <textarea
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2' || (e.ctrlKey && e.key === 's')) {
                      e.preventDefault();
                      handleSaveFile();
                    }
                    if (e.key === 'Escape') {
                      setIsEditing(false);
                    }
                  }}
                  autoFocus
                  className="w-full h-full bg-transparent text-cyan-400 font-mono text-sm outline-none resize-none p-4 scrollbar-thin scrollbar-thumb-cyan-400/20"
                  spellCheck={false}
                />
              </div>
              <div className="p-3 bg-cyan-900/20 border-t border-cyan-400/30 flex justify-between items-center">
                <div className="text-[10px] text-cyan-600 font-bold uppercase tracking-widest">
                  {isSaving ? 'Synchronizing Neural Data...' : 'Ready for modification'}
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-1 border border-cyan-400/50 text-cyan-400 text-xs hover:bg-cyan-900 transition-colors"
                  >
                    CANCEL
                  </button>
                  <button 
                    onClick={handleSaveFile}
                    disabled={isSaving}
                    className="px-6 py-1 bg-cyan-400 text-black font-bold text-xs hover:bg-white transition-colors disabled:opacity-50"
                  >
                    {isSaving ? 'SAVING...' : 'SAVE (F2)'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-black border-2 border-cyan-400 shadow-[0_0_50px_rgba(34,211,238,0.3)] rounded-sm overflow-hidden"
            >
              <div className="bg-cyan-400 text-black px-4 py-2 flex justify-between items-center font-black tracking-widest text-xs uppercase">
                <span>SANDYBOX_LINK_CONFIG</span>
                <button onClick={() => setIsSettingsOpen(false)} className="hover:bg-white px-2 py-0.5 rounded-sm transition-colors text-black">X</button>
              </div>
              <div className="p-8 space-y-8 relative">
                <div className="absolute inset-0 neural-grid opacity-5 pointer-events-none" />
                
                <div className="space-y-3 relative z-10">
                  <label className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.3em]">Sandybox Host</label>
                  <div className="relative group">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/30 group-focus-within:text-cyan-400 transition-colors" />
                    <input
                      type="text"
                      value={ollamaHost}
                      onChange={(e) => setOllamaHost(e.target.value)}
                      placeholder="https://ollama.com"
                      className="w-full pl-10 pr-4 py-3 bg-black/60 border-2 border-cyan-900 focus:border-cyan-400 text-cyan-400 text-sm outline-none transition-all rounded-sm shadow-inner"
                    />
                  </div>
                </div>

                <div className="space-y-3 relative z-10">
                  <label className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.3em]">Access Key</label>
                  <div className="relative group">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/30 group-focus-within:text-cyan-400 transition-colors" />
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="ENTER_AUTHORIZATION_KEY..."
                      className="w-full pl-10 pr-4 py-3 bg-black/60 border-2 border-cyan-900 focus:border-cyan-400 text-cyan-400 text-sm outline-none transition-all rounded-sm shadow-inner"
                    />
                  </div>
                </div>

                <div className="space-y-3 relative z-10">
                  <label className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.3em]">Sandybox Model</label>
                  <div className="relative group">
                    <Settings className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/30 group-focus-within:text-cyan-400 transition-colors" />
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full pl-10 pr-10 py-3 bg-black/60 border-2 border-cyan-900 focus:border-cyan-400 text-cyan-400 text-sm outline-none appearance-none cursor-pointer rounded-sm"
                    >
                      {models.map((m, idx) => (
                        <option key={idx} value={m.name} className="bg-black">{m.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/30 pointer-events-none" />
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-cyan-400/5 border border-cyan-400/20 rounded-sm relative z-10">
                  <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">STREAMING_PROTOCOL</span>
                  <button
                    onClick={() => setStreamEnabled(!streamEnabled)}
                    className={cn(
                      "relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-black",
                      streamEnabled ? "bg-cyan-400" : "bg-cyan-900"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-black shadow-md transition-transform",
                      streamEnabled ? "translate-x-7" : "translate-x-1"
                    )} />
                  </button>
                </div>

                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full py-4 bg-cyan-400 text-black font-black text-xs hover:bg-white transition-all uppercase tracking-[0.3em] rounded-sm shadow-lg shadow-cyan-900/20 active:scale-95"
                >
                  Save & Initialize
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header / Config Bar */}
      <header className="relative z-50 bg-black/60 backdrop-blur-xl border-b-2 border-cyan-400/30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-4 group">
            <div className="relative">
              <div className="absolute inset-0 bg-cyan-400 blur-md opacity-20 group-hover:opacity-40 transition-opacity" />
              <Zap className="w-8 h-8 md:w-10 md:h-10 text-cyan-400 relative" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl md:text-2xl font-black text-cyan-500/90 tracking-tighter leading-none italic uppercase">Sandybox</h1>
              <p className="text-[7px] text-cyan-800 uppercase font-black tracking-widest hidden md:block mt-0.5">Adaptive Neural Interface Subsystem</p>
              <div className="flex items-center gap-2 mt-1">
                <div className={cn(
                  "w-2 h-2 rounded-full animate-pulse",
                  connectionStatus === 'connected' ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-red-500 shadow-[0_0_8px_#ef4444]"
                )} />
                <span className="text-[10px] text-cyan-600 font-bold uppercase tracking-[0.3em]">
                  {connectionStatus === 'connected' ? 'SYSTEM ONLINE' : 'LINK SEVERED'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-6 px-4 py-2 bg-black/40 border border-cyan-400/10 rounded-sm mr-4">
              <div className="flex flex-col">
                <span className="text-[8px] text-cyan-600 uppercase font-black tracking-widest">Protocol</span>
                <span className="text-[10px] text-cyan-400 font-bold uppercase">SEC-OLLAMA-TCP</span>
              </div>
              <div className="h-4 w-[1px] bg-cyan-400/20" />
              <div className="flex flex-col">
                <span className="text-[8px] text-cyan-600 uppercase font-black tracking-widest">Core Status</span>
                <span className="text-[10px] text-white font-bold uppercase">{connectionStatus}</span>
              </div>
            </div>

            <div className="flex bg-black shadow-inner border border-cyan-400/20 p-1 rounded-sm">
              <button
                onClick={() => setActiveTab('chat')}
                className={cn(
                  "px-4 py-1.5 text-[10px] font-bold transition-all uppercase tracking-widest",
                  activeTab === 'chat' ? "bg-cyan-400 text-black shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "text-cyan-400 hover:bg-cyan-900/30"
                )}
              >
                CORE_LINK
              </button>
              <button
                onClick={() => setActiveTab('terminal')}
                className={cn(
                  "px-4 py-1.5 text-[10px] font-bold transition-all uppercase tracking-widest",
                  activeTab === 'terminal' ? "bg-cyan-400 text-black shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "text-cyan-400 hover:bg-cyan-900/30"
                )}
              >
                SHELL_SYNC
              </button>
              <button
                onClick={() => setActiveTab('backroom')}
                className={cn(
                  "px-4 py-1.5 text-[10px] font-bold transition-all uppercase tracking-widest",
                  activeTab === 'backroom' ? "bg-cyan-400 text-black shadow-[0_0_10px_rgba(34,211,238,0.5)]" : "text-cyan-400 hover:bg-cyan-900/30"
                )}
              >
                BACK_ROOM
              </button>
            </div>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2.5 bg-black border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400 hover:text-black transition-all hover:shadow-[0_0_15px_rgba(34,211,238,0.3)]"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              onClick={fetchModels}
              className="p-2.5 bg-black border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400 hover:text-black transition-all hover:shadow-[0_0_15px_rgba(34,211,238,0.3)]"
            >
              <RefreshCw className={cn("w-4 h-4", isFetchingModels && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col max-w-7xl mx-auto w-full relative z-10 px-4 md:px-6 py-4 md:py-6 overflow-hidden min-h-0">
        <AnimatePresence mode="wait">
          {activeTab === 'chat' ? (
            <motion.div
              key="chat-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col glass-panel rounded-sm min-h-0 overflow-hidden"
            >
              <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 md:p-8 space-y-12 scroll-smooth scrollbar-thin overflow-x-hidden min-h-0"
              >
                {messages.length === 0 && !error && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in zoom-in duration-700">
                    <div className="relative group">
                      <div className="absolute inset-0 bg-cyan-400 blur-3xl opacity-10 group-hover:opacity-20 transition-opacity animate-pulse-glow" />
                      <div className="relative p-8 border-2 border-cyan-400/20 bg-black/40 rounded-full">
                        <Bot className="w-24 h-24 text-cyan-400/30" />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h2 className="text-3xl md:text-5xl text-cyan-300/80 font-black tracking-tighter italic uppercase">
                        {AGENTS.find(a => a.id === activePersonaId)?.name || 'CORTEX'}_IDLE
                      </h2>
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center justify-center gap-4">
                          <div className="h-[1px] w-12 bg-cyan-400/10" />
                          <p className="text-[10px] font-mono text-cyan-700/60 tracking-[0.4em] uppercase font-bold">
                            {AGENTS.find(a => a.id === activePersonaId)?.role || 'Link Established'} • Awaiting Command
                          </p>
                          <div className="h-[1px] w-12 bg-cyan-400/10" />
                        </div>
                        <p className="text-[9px] text-cyan-900/40 uppercase tracking-[0.2em] font-black max-w-md">
                          Neural node active. Persona construct loaded and ready for interaction.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-6 bg-red-500/5 border-2 border-red-500/30 text-red-400 text-xs font-mono rounded-sm flex items-start gap-4">
                    <Activity className="w-5 h-5 flex-shrink-0 animate-pulse" />
                    <div>
                      <span className="font-black uppercase tracking-widest block mb-1">CRITICAL_EXCEPTION</span>
                      <p className="opacity-80">{error}</p>
                    </div>
                  </div>
                )}

                {messages.map((msg, idx) => {
                  if (msg.isSystemFeedback) {
                    return (
                      <div key={`msg-${idx}-sys`} className="flex gap-4 p-4 max-w-5xl mx-auto w-full bg-cyan-900/10 border border-cyan-400/20 rounded-sm">
                        <Activity className="w-4 h-4 text-cyan-500 mt-1" />
                        <div className="font-mono text-[10px] text-cyan-400/80 whitespace-pre-wrap break-all uppercase tracking-widest">{msg.content}</div>
                      </div>
                    );
                  }

                  const agentInfo = msg.agentId ? AGENTS.find(a => a.id === msg.agentId) : null;
                  const displayName = msg.role === 'user' ? 'OPERATOR_SYNC' : (agentInfo?.name ? agentInfo.name.toUpperCase() : 'SANDYBOX_CORE');

                  return (
                  <div 
                    key={`msg-${idx}-${msg.role}`}
                    className={cn(
                      "flex gap-6 p-1 transition-all group max-w-5xl mx-auto w-full",
                      msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <div className="flex-shrink-0 mt-2">
                      {msg.role === 'user' ? (
                        <div className="w-12 h-12 bg-black border border-cyan-400/20 rounded-full flex items-center justify-center text-cyan-600 group-hover:border-cyan-400 transition-colors shadow-lg">
                          <User className="w-6 h-6" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 bg-cyan-400/5 border border-cyan-400/20 rounded-sm flex items-center justify-center text-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.1)]">
                          <Bot className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    <div className={cn(
                      "flex-1 min-w-0 space-y-2",
                      msg.role === 'user' ? "text-right" : "text-left"
                    )}>
                      <div className="flex items-center gap-3 opacity-40 group-hover:opacity-100 transition-opacity justify-start" style={{ flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                        <span className="text-[9px] font-black uppercase text-cyan-700 tracking-[0.3em]">
                          {displayName}
                        </span>
                        <div className="h-[1px] flex-1 bg-cyan-400/10" />
                      </div>
                      <div className={cn(
                        "text-[15px] leading-relaxed p-6 rounded-sm prose prose-invert prose-cyan max-w-none shadow-xl border border-cyan-400/10",
                        msg.role === 'user' 
                          ? "bg-cyan-400/[0.03] border-r-2 border-r-cyan-400/30" 
                          : "bg-white/[0.02] border-l-2 border-l-cyan-400/20"
                      )}>
                        {(() => {
                          const htmlMatch = msg.content.match(/\[\[RENDER_HTML:\s*([\s\S]*?)\]\]/);
                          if (htmlMatch) {
                            const htmlContent = htmlMatch[1];
                            const cleanedContent = msg.content.replace(/\[\[RENDER_HTML:\s*[\s\S]*?\]\]/g, '\n\n*(HTML Preview Rendered Below)*\n\n');
                            return (
                              <div className="space-y-6">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{cleanedContent}</ReactMarkdown>
                                <div className="border border-cyan-400/30 rounded-sm overflow-hidden bg-white mt-4 shadow-[0_0_30px_rgba(34,211,238,0.15)] group/frame relative">
                                  <div className="bg-cyan-900 border-b border-cyan-400/20 px-3 py-2 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Globe className="w-3 h-3 text-cyan-400" />
                                      <span className="text-[10px] font-black uppercase text-cyan-400 tracking-widest">Neural_Layer_Viewport</span>
                                    </div>
                                    <div className="flex gap-1.5">
                                      <div className="w-2 h-2 rounded-full bg-cyan-400/20" />
                                      <div className="w-2 h-2 rounded-full bg-cyan-400/20" />
                                      <div className="w-2 h-2 rounded-full bg-cyan-400/20" />
                                    </div>
                                  </div>
                                  <div className="bg-white">
                                    <iframe 
                                      srcDoc={htmlContent}
                                      className="w-full h-[500px] bg-white border-none"
                                      title="Agent HTML Preview"
                                      sandbox="allow-scripts"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeRaw]}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )})}

                {isLoading && messages[messages.length - 1]?.role === 'user' && (
                  <div className="flex gap-5 p-6 bg-cyan-400/[0.02] border border-cyan-400/10 rounded-sm animate-pulse">
                    <div className="w-10 h-10 bg-cyan-400/5 border border-cyan-400/10 rounded-sm flex items-center justify-center text-cyan-400/50">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                    <div className="flex-1 space-y-3 py-1">
                      <div className="h-2 bg-cyan-400/10 rounded w-1/4"></div>
                      <div className="h-2 bg-cyan-400/10 rounded w-3/4"></div>
                      <div className="h-2 bg-cyan-400/10 rounded w-1/2"></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input Area */}
              <div className="p-4 md:p-6 border-t border-cyan-400/10 bg-[#08080c]/80 backdrop-blur-md">
                <form onSubmit={handleSubmit} className="flex gap-2 md:gap-3 max-w-4xl mx-auto w-full">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={apiKey ? "Transmit data..." : "Awaiting Authorization Key"}
                      disabled={!apiKey || isLoading}
                      className="w-full px-4 md:px-5 py-3 md:py-4 bg-black border-2 border-cyan-900 focus:border-cyan-400 rounded-sm text-sm text-cyan-400 placeholder:text-cyan-900 transition-all outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!input.trim() || !apiKey || isLoading || !selectedModel}
                    className="px-4 md:px-8 py-3 md:py-4 bg-cyan-400 text-black font-black uppercase tracking-widest text-[10px] md:text-xs rounded-sm hover:bg-white active:scale-95 transition-all disabled:opacity-20 flex items-center gap-2 md:gap-3 shadow-lg shadow-cyan-900/20"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span className="hidden xs:inline">Execute</span>
                  </button>
                </form>
              </div>
            </motion.div>
          ) : activeTab === 'terminal' ? (
            <motion.div
              key="terminal-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col p-2 md:p-4 space-y-4 min-h-0"
            >
              {/* Main Terminal Layout */}
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
                
                {/* Left Side: Neural Commander (Single Pane) */}
                <div className="flex flex-col glass-panel rounded-sm overflow-hidden min-h-[300px] lg:min-h-0 relative">
                  <div className="absolute inset-0 neural-subgrid opacity-10 pointer-events-none" />
                  <div className="relative z-10 bg-cyan-400 text-black px-3 py-2 flex justify-between items-center font-mono text-[10px] font-bold shadow-[0_2px_10px_rgba(34,211,238,0.3)]">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-black rounded-full animate-pulse" />
                      <span className="tracking-widest">SANDYBOX_COMMANDER_V1.0</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={async () => {
                          const res = await piService.getFiles(leftPane.path);
                          setLeftPane(res);
                          addLog('info', 'Manual refresh of Sandybox Commander');
                        }}
                        className="hover:scale-110 transition-transform active:rotate-180 duration-500"
                        title="Refresh Files"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", isAgentExecuting && "animate-spin")} />
                      </button>
                      <Activity className={cn("w-3.5 h-3.5", isAgentExecuting && "animate-pulse text-red-600")} />
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col overflow-hidden relative z-10">
                    <div className="bg-black/60 text-cyan-400/70 px-3 py-1.5 text-[9px] font-black border-b border-cyan-400/10 flex items-center gap-2">
                      <span className="text-cyan-600 font-bold">$ PATH_ROOT:</span>
                      <span className="truncate tracking-wider">{leftPane.path || 'C:\\'}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto font-mono text-[10px] scrollbar-thin">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-neural-bg/80 backdrop-blur-md text-cyan-400/50 border-b border-cyan-400/20 z-20">
                          <tr>
                            <th className="p-2 md:p-3 font-black uppercase tracking-tighter text-[9px]">Identifier</th>
                            <th className="p-2 md:p-3 font-black uppercase tracking-tighter text-[9px] text-right hidden xs:table-cell">Payload</th>
                            <th className="p-2 md:p-3 font-black uppercase tracking-tighter text-[9px] text-right">M_Time</th>
                          </tr>
                        </thead>
                        <tbody className="text-cyan-50/80">
                          {leftPane.path && (
                            <tr 
                              onClick={() => {
                                handleFileClick({ name: '..', isDirectory: true, size: 0, mtime: '' });
                                setSelectedIndex(0);
                              }}
                              onMouseEnter={() => setSelectedIndex(0)}
                              className={cn(
                                "cursor-pointer transition-all duration-75 border-b border-cyan-400/5",
                                selectedIndex === 0 ? "bg-cyan-400 text-black font-bold shadow-[0_0_15px_rgba(34,211,238,0.2)]" : "hover:bg-cyan-400/10"
                              )}
                            >
                              <td className="p-2 md:p-3 flex items-center gap-3">
                                <span className={cn(
                                  "font-black text-xs",
                                  selectedIndex === 0 ? "text-black" : "text-cyan-400"
                                )}>◂</span>
                                <span className="truncate">UP_LEVEL</span>
                              </td>
                              <td className="p-2 md:p-3 text-right font-black hidden xs:table-cell tracking-widest opacity-40">--DIR--</td>
                              <td className="p-2 md:p-3 text-right opacity-30 tabular-nums">XX.XX.XX</td>
                            </tr>
                          )}
                          {leftPane.files.map((file, idx) => {
                            const actualIdx = leftPane.path ? idx + 1 : idx;
                            return (
                              <tr 
                                key={idx} 
                                onClick={() => {
                                  handleFileClick(file);
                                  setSelectedIndex(actualIdx);
                                }}
                                onMouseEnter={() => setSelectedIndex(actualIdx)}
                                className={cn(
                                  "cursor-pointer transition-all duration-75 border-b border-cyan-400/5",
                                  selectedIndex === actualIdx ? "bg-cyan-400 text-black font-bold shadow-[0_0_15px_rgba(34,211,238,0.2)]" : "hover:bg-cyan-400/10"
                                )}
                              >
                                <td className="p-2 md:p-3 flex items-center gap-3">
                                  {file.isDirectory ? 
                                    <span className={cn("font-black text-xs", selectedIndex === actualIdx ? "text-black" : "text-cyan-400")}>▸</span> : 
                                    <span className={cn("text-xs opacity-30", selectedIndex === actualIdx ? "text-black" : "text-cyan-900")}>·</span>
                                  }
                                  <span className="truncate">{file.name}</span>
                                </td>
                                <td className="p-2 md:p-3 text-right font-black hidden xs:table-cell tabular-nums">
                                  {file.isDirectory ? 
                                    <span className="tracking-widest opacity-40">--DIR--</span> : 
                                    <span className="opacity-60">{(file.size / 1024).toFixed(1)}k</span>
                                  }
                                </td>
                                <td className="p-2 md:p-3 text-right opacity-40 tabular-nums text-[9px]">
                                  {new Date(file.mtime).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '.')}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* System Health Bar */}
                    {systemInfo && (
                      <div className="bg-black/80 backdrop-blur-md border-t-2 border-cyan-400/30 p-2 flex gap-6 text-[9px] font-black text-cyan-400/60 uppercase tracking-widest overflow-x-auto whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-3 h-3 text-cyan-600" />
                          <span>CPU_LOD: <span className="text-white">{systemInfo.cpuLoad}%</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <HardDrive className="w-3 h-3 text-cyan-600" />
                          <span>MEM_USE: <span className="text-white">{systemInfo.memory.used}/{systemInfo.memory.total}MB</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Activity className="w-3 h-3 text-cyan-600" />
                          <span>UP_TIME: <span className="text-white">{(systemInfo.uptime / 3600).toFixed(1)}H</span></span>
                        </div>
                        <div className="flex items-center gap-2 ml-4 border-l border-cyan-400/20 pl-4">
                          <DatabaseIcon className="w-3 h-3 text-cyan-600" />
                          <span className="text-neural-success">DB_ACTIVE</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Side: Terminal Panel */}
                <div className="flex flex-col glass-panel rounded-sm overflow-hidden min-h-[400px] lg:h-full relative">
                  <div className="absolute inset-0 neural-grid opacity-5 pointer-events-none" />
                  <div className="relative z-10 bg-cyan-400 text-black px-3 py-2 font-mono text-[10px] font-bold flex justify-between items-center shadow-[0_2px_10px_rgba(34,211,238,0.3)]">
                    <div className="flex items-center gap-3">
                      <Terminal className="w-3.5 h-3.5" />
                      <span className="tracking-widest capitalize">COGNITIVE_SHELL_V1.0</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setTerminalHistory([])}
                        className="hover:scale-110 transition-transform p-0.5 rounded-full hover:bg-black/10"
                        title="Purge History"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div 
                    ref={terminalRef}
                    className="flex-1 overflow-y-auto p-4 md:p-6 font-mono text-[11px] space-y-4 bg-black/60 relative z-10 scrollbar-thin"
                  >
                    {terminalHistory.length === 0 && (
                      <div className="text-cyan-900 font-black italic tracking-widest flex items-center gap-2">
                        <Bot className="w-4 h-4 animate-pulse" />
                        AWAITING_NEURAL_COMMANDS...
                      </div>
                    )}
                    {terminalHistory.map((entry) => (
                      <div key={entry.id} className="space-y-2 animate-in fade-in slide-in-from-left duration-300">
                        <div className="flex items-center gap-3 bg-cyan-400/5 p-2 border border-cyan-400/10 rounded-sm">
                          <span className="text-[9px] text-cyan-700 font-bold tracking-tighter">[{entry.time}]</span>
                          <span className="text-neural-success font-black tracking-tight text-[10px]">root@pi:~$</span>
                          <span className="text-white font-medium tracking-tight">{entry.command}</span>
                        </div>
                        <div className={cn(
                          "pl-6 border-l-2 border-cyan-900/40 whitespace-pre-wrap break-all py-1 font-mono",
                          entry.type === 'error' ? "text-neural-critical font-bold mt-1" : "text-cyan-400/90"
                        )}>
                          {entry.output}
                        </div>
                      </div>
                    ))}
                    {isAgentExecuting && (
                      <div className="flex items-center gap-3 animate-pulse bg-cyan-400/5 p-2 rounded-sm border border-cyan-400/10">
                        <span className="text-neural-success font-black tracking-tight text-[10px]">root@pi:~$</span>
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                          <span className="text-cyan-600 text-[10px] font-black tracking-widest uppercase">Executing_Neural_Sequence...</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Terminal Input */}
                  <div className="p-4 border-t-2 border-cyan-400/30 bg-black/40 backdrop-blur-md relative z-20">
                    <form onSubmit={handleTerminalSubmit} className="flex gap-3 max-w-5xl mx-auto w-full">
                      <div className="flex-1 relative group">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-neural-success font-black text-[10px] tracking-tight flex items-center gap-2">
                          root@pi:~$
                          <div className="w-[2px] h-3 bg-neural-success animate-pulse" />
                        </div>
                        <input
                          type="text"
                          value={agentInput}
                          onChange={(e) => setAgentInput(e.target.value)}
                          placeholder="Transmit neural instruction..."
                          className="w-full pl-28 pr-4 py-3 bg-black/60 border-2 border-cyan-900/50 focus:border-cyan-400 text-cyan-400 text-xs outline-none transition-all rounded-sm placeholder:text-cyan-900 shadow-inner group-hover:border-cyan-400/30"
                          disabled={isAgentExecuting}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!agentInput.trim() || isAgentExecuting}
                        className="px-6 py-3 bg-cyan-400 text-black font-black text-[10px] uppercase tracking-[0.2em] hover:bg-white active:scale-95 transition-all disabled:opacity-20 rounded-sm shadow-lg shadow-cyan-900/20"
                      >
                        {isAgentExecuting ? 'BUSY' : 'EXEC'}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="backroom-tab"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="flex-1 flex flex-col space-y-6 min-h-0"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Model Selection Board */}
                <div className="lg:col-span-1 flex flex-col glass-panel overflow-hidden border-2 border-cyan-400/20">
                  <div className="bg-cyan-400/10 px-4 py-3 border-b border-cyan-400/20 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-cyan-400">Available_Models</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
                    {models.map((model, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setSelectedModel(model.name);
                          addLog('info', `Switching Sandybox Core to: ${model.name}`);
                        }}
                        className={cn(
                          "w-full text-left p-3 rounded-sm transition-all flex items-center justify-between border group",
                          selectedModel === model.name 
                            ? "bg-cyan-400 border-cyan-400 text-black font-black" 
                            : "bg-black/40 border-cyan-400/10 text-cyan-400/70 hover:border-cyan-400 hover:text-cyan-400"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Cpu className={cn("w-4 h-4", selectedModel === model.name ? "text-black" : "text-cyan-600")} />
                          <span className="text-xs uppercase tracking-wider">{model.name}</span>
                        </div>
                        <div className="text-[8px] opacity-60">
                          {(model.size / 1024 / 1024 / 1024).toFixed(1)}GB
                        </div>
                      </button>
                    ))}
                    {models.length === 0 && (
                      <div className="p-8 text-center text-cyan-900 font-black uppercase text-xs">
                        No Models Synthesized
                      </div>
                    )}
                  </div>
                </div>

                {/* Agent Communication Sync Terminal */}
                <div className="lg:col-span-1 flex flex-col glass-panel overflow-hidden border border-cyan-400/10 bg-black/40 relative">
                  <div className="absolute inset-0 neural-subgrid opacity-5 pointer-events-none" />
                  <div className="bg-cyan-900/20 px-4 py-3 border-b border-cyan-400/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Share2 className="w-3 h-3 text-cyan-400 animate-pulse" />
                      <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">Agent_Link</span>
                    </div>
                    <div className="flex gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/20" />
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/20" />
                    </div>
                  </div>

                  <div className="flex-1 p-4 flex flex-col space-y-4 overflow-y-auto scrollbar-thin relative z-10 font-mono">
                    <div className="text-[10px] text-cyan-400 uppercase tracking-widest font-black border-b border-cyan-400/10 pb-2">
                      Active Persona 
                    </div>
                    
                    <div className="space-y-2 flex-1">
                      {AGENTS.map((agent) => (
                        <button
                          key={agent.id}
                          onClick={() => {
                            setActivePersonaId(agent.id);
                            addLog('info', `Neural Link Switched: ${agent.name} [${agent.role}]`);
                          }}
                          className={cn(
                            "w-full text-left p-3 rounded-sm transition-all border group",
                            activePersonaId === agent.id
                              ? "bg-cyan-400 border-cyan-400 text-black shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                              : "bg-black/40 border-cyan-400/10 hover:border-cyan-400/50 hover:bg-cyan-900/20"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className={cn(
                              "text-xs font-black uppercase tracking-wider",
                              activePersonaId === agent.id ? "text-black" : "text-cyan-400"
                            )}>
                              {agent.name}
                            </span>
                            {activePersonaId === agent.id && (
                              <div className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                            )}
                          </div>
                          <div className={cn(
                            "text-[9px] uppercase tracking-widest mt-1",
                            activePersonaId === agent.id ? "text-neural-dark opacity-80" : "text-cyan-600"
                          )}>
                            {agent.role}
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="mt-auto pt-4 italic text-cyan-900/40 text-[8px] uppercase tracking-widest leading-relaxed">
                      "Injecting personality constructs into cognitive shell"
                    </div>
                  </div>

                  {/* System Access Guide */}
                  <div className="mt-4 p-4 bg-orange-400/5 border border-orange-400/20 rounded-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-3 h-3 text-orange-500 animate-pulse" />
                      <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest">RASPBERRY_PI_OPTIMIZATION</span>
                    </div>
                    <div className="space-y-3 text-[10px] text-orange-200/60 leading-relaxed">
                      <p>To give Neo power over system services (systemctl, apt, stop/start), run this in your Pi terminal:</p>
                      <div className="p-2 bg-black border border-orange-900/30 font-mono text-orange-400 select-all break-all">
                        echo "$(whoami) ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/sandybox-ai
                      </div>
                      <p className="opacity-40 italic">This enables non-interactive sudo for the AI Core.</p>
                    </div>
                  </div>
                </div>

                {/* System Activity Stream */}
                <div className="lg:col-span-1 flex flex-col glass-panel overflow-hidden border-2 border-cyan-400/20 shadow-[0_0_40px_rgba(34,211,238,0.05)]">

                  <div className="bg-black/60 px-4 py-3 border-b border-cyan-400/20 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                      <h3 className="text-xs font-black uppercase tracking-[0.2em] text-cyan-400">Live_Activity_Stream</h3>
                    </div>
                    <button 
                      onClick={() => setAgentLogs([])}
                      className="text-[9px] text-cyan-700 hover:text-red-500 font-bold flex items-center gap-2 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      CLEAR_LOGS
                    </button>
                  </div>
                  <div 
                    ref={logRef}
                    className="flex-1 overflow-y-auto p-4 md:p-6 font-mono text-[11px] space-y-3 scrollbar-thin bg-black/60"
                  >
                    {agentLogs.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-cyan-900 border-2 border-dashed border-cyan-900/30 rounded-sm">
                        <Activity className="w-8 h-8 mb-2 opacity-50" />
                        <p className="uppercase tracking-[0.3em] font-black">Awaiting Sandybox Pulses...</p>
                      </div>
                    )}
                    {agentLogs.map((log) => (
                      <div key={log.id} className="flex gap-4 group">
                        <span className="text-cyan-900/50 flex-shrink-0 tabular-nums">[{log.time}]</span>
                        <div className="flex-1">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded-sm text-[9px] font-black uppercase tracking-widest mr-3",
                            log.type === 'error' ? "bg-red-500/10 text-red-500 border border-red-500/20" :
                            log.type === 'action' ? "bg-cyan-500/10 text-cyan-400 border border-cyan-400/20" :
                            "bg-white/5 text-white/40 border border-white/10"
                          )}>
                            {log.type}
                          </span>
                          <span className={cn(
                            "leading-relaxed break-all",
                            log.type === 'error' ? "text-red-400" :
                            log.type === 'action' ? "text-cyan-300" :
                            "text-cyan-600/80"
                          )}>
                            {log.content}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex justify-between text-[9px] font-black text-cyan-900 uppercase tracking-[0.4em] max-w-5xl mx-auto w-full pb-4 border-t border-cyan-400/5 pt-4 flex-shrink-0">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
              SANDYBOX_CORE: <span className="text-cyan-600">{selectedModel || 'STANDBY'}</span>
            </span>
            <span className="flex items-center gap-2">
              <Activity className="w-3 h-3" />
              LATENCY: 42ms
            </span>
            {systemInfo?.nodeVersion && (
              <span className="flex items-center gap-2 border-l border-cyan-900/40 pl-6 text-orange-900/60 transition-all hover:text-orange-900">
                NODE_SRV: {systemInfo.nodeVersion}
              </span>
            )}
            <span className="flex items-center gap-2 border-l border-cyan-900/20 pl-6">
              <div className="w-1.5 h-1.5 rounded-full bg-orange-600 animate-pulse" />
              HW_RAM: <span className="text-orange-900">512MB [LEAN_MODE]</span>
            </span>
          </div>
          <span className="opacity-40">COGNITIVE_OLLAMA_LINK_V2.4</span>
        </div>
      </main>
    </div>
  );
}
