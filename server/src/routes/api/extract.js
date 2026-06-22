import { v4 as uuidv4 } from 'uuid';
import { loadPDFBuffer } from '../../services/pdfService.js';
import { extractDataWithProvider } from '../../services/llmService.js';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { auditLog } from '../../audit/logger.js';

const llmCfg = () => ({
  llmProvider:     config.LLM_PROVIDER,
  ollamaUrl:       config.OLLAMA_URL,
  ollamaModel:     config.OLLAMA_MODEL,
  openaiApiKey:    config.OPENAI_API_KEY,
  openaiModel:     config.OPENAI_MODEL,
  anthropicApiKey: config.ANTHROPIC_API_KEY,
  anthropicModel:  config.ANTHROPIC_MODEL,
});

export async function extractRoutes(app) {
  // POST /api/extract
  // Body: { pdf_base64: string, filename?: string, fields: [{label, description?, enabled?}] }
  app.post('/', {
    schema: {
      body: {
        type: 'object', required: ['pdf_base64', 'fields'],
        properties: {
          pdf_base64: { type: 'string' },
          filename:   { type: 'string', default: 'document.pdf' },
          fields:     { type: 'array', minItems: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { pdf_base64, filename = 'document.pdf', fields } = req.body;

    let buf;
    try { buf = Buffer.from(pdf_base64, 'base64'); }
    catch { return reply.code(400).send({ error: 'pdf_base64 non valido' }); }

    const t0  = Date.now();
    const pdf = await loadPDFBuffer(buf);
    const result = await extractDataWithProvider(llmCfg(), fields, pdf.chunks.length ? pdf.chunks : [{ text: pdf.text }]);
    const duration = Date.now() - t0;
    const id = uuidv4();

    await db.query(
      `INSERT INTO extraction_history (id, user_email, pdf_name, pdf_size_bytes, fields, result, llm_provider, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, req.user.email, filename, buf.length, JSON.stringify(fields), JSON.stringify(result), config.LLM_PROVIDER, duration]
    );

    await auditLog({
      userEmail: req.user.email, action: 'extract', resource: filename, result: 'success',
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      details: { id, duration_ms: duration, fields_count: fields.length },
    });

    return reply.send({ id, result, pdf_name: filename, pages: pdf.numPages, duration_ms: duration });
  });
}
