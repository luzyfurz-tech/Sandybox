import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Ollama } from "ollama";
import { Client } from "ssh2";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import multer from "multer";
import Database from "better-sqlite3";
import axios from "axios";
import * as cheerio from "cheerio";

const execAsync = promisify(exec);

// Initialize Sandybox Database
const dbPath = path.join(os.homedir(), "sandybox_data.db");
const sqlite = new Database(dbPath);
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sandybox_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS chat_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    context_key TEXT UNIQUE,
    content TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO system_config (key, value) VALUES ('sandybox_version', '1.0.0');
  
  -- Seed test memory for greeting
  INSERT OR IGNORE INTO chat_memory (context_key, content) 
  VALUES ('user_last_context', 'The operator luzyfurz has just granted absolute system access on the Sandybox hardware. We are preparing for Git deployment. There is a sense of mutual trust and curiosity.');
`);
console.log(`Sandybox Database initialized at ${dbPath}`);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = (req.query.path as string) || os.homedir();
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// Helper for SSH execution
const execSsh = (config: any, command: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) return reject(err);
        let output = '';
        stream.on('close', (code: number, signal: string) => {
          conn.end();
          if (code !== 0) reject(new Error(`Exit code ${code}`));
          else resolve(output);
        }).on('data', (data: any) => {
          output += data;
        }).stderr.on('data', (data: any) => {
          output += data;
        });
      });
    }).on('error', (err) => reject(err)).connect({
      host: config.host,
      port: parseInt(config.port) || 22,
      username: config.username,
      password: config.password
    });
  });
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- Local Pi Management Endpoints ---

  // List files for the Commander UI
  app.get("/api/local/files", async (req, res) => {
    const dirPath = (req.query.path as string) || os.homedir();
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      const result = await Promise.all(files.map(async (file) => {
        const fullPath = path.join(dirPath, file.name);
        try {
          const stats = await fs.stat(fullPath);
          return {
            name: file.name,
            isDirectory: file.isDirectory(),
            size: stats.size,
            mtime: stats.mtime,
          };
        } catch {
          return {
            name: file.name,
            isDirectory: file.isDirectory(),
            size: 0,
            mtime: new Date(),
          };
        }
      }));
      res.json({ path: dirPath, files: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // System Info for the Dashboard
  app.get("/api/local/system", async (req, res) => {
    try {
      const load = os.loadavg();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      res.json({
        cpuLoad: load[0].toFixed(2),
        nodeVersion: process.version,
        memory: {
          total: (totalMem / 1024 / 1024).toFixed(0),
          free: (freeMem / 1024 / 1024).toFixed(0),
          used: ((totalMem - freeMem) / 1024 / 1024).toFixed(0),
        },
        platform: os.platform(),
        uptime: os.uptime(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Execute command (The "Muscle")
  app.post("/api/local/exec", async (req, res) => {
    const { command, cwd } = req.body;
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: cwd || os.homedir() });
      
      // Log to SQLite
      sqlite.prepare("INSERT INTO sandybox_logs (event) VALUES (?)").run(`Command Executed: ${command}`);
      
      res.json({ stdout, stderr });
    } catch (error: any) {
      sqlite.prepare("INSERT INTO sandybox_logs (event) VALUES (?)").run(`Command Failed: ${command} | Error: ${error.message}`);
      res.status(500).json({ error: error.message, stderr: error.stderr });
    }
  });

  app.post("/api/local/log", (req, res) => {
    const { event } = req.body;
    try {
      sqlite.prepare("INSERT INTO sandybox_logs (event) VALUES (?)").run(event);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Memory endpoints for AI Core
  app.post("/api/local/memory", (req, res) => {
    const { key, content } = req.body;
    try {
      sqlite.prepare(`
        INSERT INTO chat_memory (context_key, content, last_updated) 
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(context_key) DO UPDATE SET content=excluded.content, last_updated=CURRENT_TIMESTAMP
      `).run(key, content);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/local/memory/:key", (req, res) => {
    const { key } = req.params;
    try {
      const row = sqlite.prepare("SELECT content FROM chat_memory WHERE context_key = ?").get(key);
      res.json(row || { content: null });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Write file (For "Make a website")
  app.post("/api/local/write", async (req, res) => {
    const { filePath, content } = req.body;
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(os.homedir(), filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
      res.json({ success: true, path: fullPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Read file (For editing)
  app.get("/api/local/read", async (req, res) => {
    const filePath = req.query.path as string;
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(os.homedir(), filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      res.json({ content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Upload file
  app.post("/api/local/upload", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      res.json({ success: true, file: req.file });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Web Search & Fetch APIs (Ollama Compatible + Fallback) ---

  app.post("/api/search", async (req, res) => {
    const { q } = req.body;
    const apiKey = req.headers.authorization?.split(" ")[1];
    if (!apiKey || apiKey === "null") return res.status(401).json({ error: "Unauthorized" });

    const ollamaHost = req.headers['x-ollama-host'] as string || process.env.OLLAMA_HOST || "http://localhost:11434";

    try {
      // 1. Try Ollama Native Search
      const ollamaRes = await fetch(`${ollamaHost}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q })
      });

      if (ollamaRes.ok) {
        return res.json(await ollamaRes.json());
      }
    } catch (e) {
      console.log("[Search] Native Ollama search failed or absent, using fallback.");
    }

    // 2. Fallback: DuckDuckGo Scraper
    try {
      const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      const $ = cheerio.load(response.data);
      const results: any[] = [];

      $('.result').each((i, el) => {
        if (i < 5) {
          const title = $(el).find('.result__a').text().trim();
          const link = $(el).find('.result__a').attr('href');
          const snippet = $(el).find('.result__snippet').text().trim();
          results.push({ title, link, snippet });
        }
      });

      res.json({ results });
    } catch (error: any) {
      res.status(500).json({ error: "Web search fallback failed: " + error.message });
    }
  });

  app.post("/api/fetch", async (req, res) => {
    const { url } = req.body;
    const apiKey = req.headers.authorization?.split(" ")[1];
    if (!apiKey || apiKey === "null") return res.status(401).json({ error: "Unauthorized" });

    const ollamaHost = req.headers['x-ollama-host'] as string || process.env.OLLAMA_HOST || "http://localhost:11434";

    try {
      // 1. Try Ollama Native Fetch
      const ollamaRes = await fetch(`${ollamaHost}/api/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (ollamaRes.ok) {
        return res.json(await ollamaRes.json());
      }
    } catch (e) {
      console.log("[Fetch] Native Ollama fetch failed or absent, using fallback.");
    }

    // 2. Fallback: Direct Axios Fetch + Cheerio
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 8000
      });
      const $ = cheerio.load(response.data);
      
      // Clean up
      $('script, style, nav, footer, header').remove();
      
      const text = $('body').text()
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 10000); // Limit to 10k chars

      res.json({ content: text });
    } catch (error: any) {
      res.status(500).json({ error: "Web fetch fallback failed: " + error.message });
    }
  });

  // Agent Deployment Endpoint (SSH based)
  app.post("/api/agent/deploy", async (req, res) => {
    const { dockerfile, ssh } = req.body;
    const apiKey = req.headers.authorization?.split(" ")[1];

    if (!apiKey) return res.status(401).json({ error: "Unauthorized" });
    if (!ssh || !ssh.host) return res.status(400).json({ error: "SSH config required" });

    try {
      // 1. Create remote temp dir and Dockerfile
      const remoteTempDir = `/tmp/agent-${Date.now()}`;
      const escapedDockerfile = dockerfile.replace(/'/g, "'\\''");
      
      await execSsh(ssh, `mkdir -p ${remoteTempDir} && echo '${escapedDockerfile}' > ${remoteTempDir}/Dockerfile`);
      
      // 2. Build and Run
      const projectName = `agent-app-${Date.now()}`;
      await execSsh(ssh, `cd ${remoteTempDir} && docker build -t ${projectName} .`);
      const runOutput = await execSsh(ssh, `docker run -d -p 0:80 ${projectName}`);
      
      res.json({ 
        status: "Deployment successful", 
        containerId: runOutput.trim(),
        logs: "Container started via SSH" 
      });
    } catch (error: any) {
      console.error("SSH Deployment Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Agent Execution Endpoint (General SSH Commands)
  app.post("/api/agent/exec", async (req, res) => {
    const { command, ssh } = req.body;
    const apiKey = req.headers.authorization?.split(" ")[1];

    if (!apiKey) return res.status(401).json({ error: "Unauthorized" });
    if (!ssh || !ssh.host) return res.status(400).json({ error: "SSH config required" });

    try {
      const output = await execSsh(ssh, command);
      res.json({ status: "Success", output });
    } catch (error: any) {
      console.error("SSH Exec Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Proxy for Ollama Tags (List Models)
  app.get("/api/models", async (req, res) => {
    const apiKey = req.headers.authorization?.split(" ")[1];
    
    // Validate API Key
    if (!apiKey || apiKey === "null" || apiKey === "undefined") {
      return res.status(401).json({ error: "API Key required. Please set it in Settings." });
    }

    try {
      // Priority: 1. x-ollama-host header, 2. Env variable, 3. Default
      const ollamaHost = req.headers['x-ollama-host'] as string || process.env.OLLAMA_HOST || "http://localhost:11434";
      const ollamaApiKey = process.env.OLLAMA_API_KEY || apiKey;

      console.log(`[Ollama Proxy] Fetching models from: ${ollamaHost}`);

      const response = await fetch(`${ollamaHost}/api/tags`, {
        headers: ollamaApiKey && ollamaApiKey !== "undefined" ? {
          Authorization: `Bearer ${ollamaApiKey}`,
        } : {},
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Ollama Proxy] Error fetching models: ${response.status} ${errorText}`);
        return res.status(response.status).json({ error: `Ollama error (${response.status}): ${errorText}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Ollama Proxy] Fetching models failed:", error.message);
      res.status(500).json({ error: `Failed to fetch models: ${error.message}` });
    }
  });

  // API Proxy for Ollama Chat (Streaming)
  app.post("/api/chat", async (req, res) => {
    const { model, messages, stream } = req.body;
    const apiKey = req.headers.authorization?.split(" ")[1];

    if (!apiKey || apiKey === "null" || apiKey === "undefined") {
      return res.status(401).json({ error: "API Key required. Please set it in Settings." });
    }

    try {
      const ollamaHost = req.headers['x-ollama-host'] as string || process.env.OLLAMA_HOST || "http://localhost:11434";
      const ollamaApiKey = process.env.OLLAMA_API_KEY || apiKey;

      const ollama = new Ollama({
        host: ollamaHost,
        headers: ollamaApiKey && ollamaApiKey !== "undefined" ? {
          Authorization: `Bearer ${ollamaApiKey}`,
        } : {},
      });

      if (stream) {
        const response = await ollama.chat({
          model,
          messages,
          stream: true,
        });

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        for await (const part of response) {
          res.write(`data: ${JSON.stringify(part)}\n\n`);
        }
        res.end();
      } else {
        const response = await ollama.chat({
          model,
          messages,
          stream: false,
        });
        res.json(response);
      }
    } catch (error: any) {
      console.error("[Ollama Proxy] Chat failed:", error.message);
      const status = error.status || (error.message?.includes('unauthorized') ? 401 : 500);
      res.status(status).json({ 
        error: error.message || "Internal Server Error",
        details: error.toString()
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
