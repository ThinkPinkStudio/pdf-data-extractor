import http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { config, mcpAllowedIps } from '../config.js';
import { loadPDFBuffer } from '../services/pdfService.js';
import { extractDataWithProvider } from '../services/llmService.js';
import * as queueService from '../services/queueService.js';
import { auditLog } from '../audit/logger.js';
import ipRangeCheck from 'ip-range-check';

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return (fwd || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function isAllowed(ip) {
  return mcpAllowedIps.some(range => {
    try { return ipRangeCheck(ip, range); } catch { return ip === range; }
  });
}

function buildMcpServer() {
  const llmCfg = {
    llmProvider: config.LLM_PROVIDER, ollamaUrl: config.OLLAMA_URL,
    ollamaModel: config.OLLAMA_MODEL, openaiApiKey: config.OPENAI_API_KEY,
    openaiModel: config.OPENAI_MODEL, anthropicApiKey: config.ANTHROPIC_API_KEY,
    anthropicModel: config.ANTHROPIC_MODEL,
  };

  const server = new McpServer({ name: 'pdf-extractor-mcp', version: '1.0.0' });

  server.tool('extract_pdf',
    'Estrai dati strutturati da un PDF (contenuto base64)',
    {
      pdf_base64: z.string().describe('Contenuto PDF in base64'),
      filename:   z.string().optional().default('document.pdf'),
      fields:     z.array(z.object({
        label:       z.string(),
        description: z.string().optional(),
        enabled:     z.boolean().optional(),
      })).describe('Campi da estrarre'),
    },
    async ({ pdf_base64, filename, fields }) => {
      const buf    = Buffer.from(pdf_base64, 'base64');
      const pdf    = await loadPDFBuffer(buf);
      const result = await extractDataWithProvider(llmCfg, fields, pdf.chunks.length ? pdf.chunks : [{ text: pdf.text }]);
      await auditLog({ action: 'mcp_extract', resource: filename, result: 'success', details: { via: 'mcp' } });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('list_queue_jobs',
    'Elenca i job nella coda di elaborazione',
    {
      status: z.enum(['pending','processing','completed','failed','cancelled']).optional(),
      limit:  z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ status, limit }) => {
      const jobs = await queueService.listJobs({ status, limit });
      return { content: [{ type: 'text', text: JSON.stringify(jobs, null, 2) }] };
    }
  );

  server.tool('create_queue_job',
    'Crea un nuovo job di analisi nella coda',
    {
      folder_path: z.string().describe('Percorso della cartella da elaborare'),
      config:      z.record(z.unknown()).optional().default({}),
    },
    async ({ folder_path, config: jobConfig }) => {
      const job = await queueService.createJob({ submittedBy: 'mcp-client', folderPath: folder_path, config: jobConfig });
      await auditLog({ action: 'mcp_queue_job_created', resource: folder_path, result: 'success', details: { jobId: job.id } });
      return { content: [{ type: 'text', text: JSON.stringify(job, null, 2) }] };
    }
  );

  server.tool('get_queue_job',
    'Recupera lo stato di un job',
    { id: z.string().describe('ID del job') },
    async ({ id }) => {
      const job = await queueService.getJob(id);
      if (!job) return { content: [{ type: 'text', text: 'Job non trovato' }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(job, null, 2) }] };
    }
  );

  return server;
}

export async function startMcpServer() {
  const httpServer = http.createServer(async (req, res) => {
    const ip = clientIp(req);

    if (!isAllowed(ip)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'IP non autorizzato', ip }));
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'pdf-extractor-mcp' }));
      return;
    }

    if (req.url === '/mcp' || req.url?.startsWith('/mcp?') || req.url?.startsWith('/mcp/')) {
      const mcpServer = buildMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => transport.close().catch(() => {}));
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.url);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise((resolve, reject) => {
    httpServer.listen(config.MCP_PORT, '0.0.0.0', resolve);
    httpServer.on('error', reject);
  });

  return httpServer;
}
