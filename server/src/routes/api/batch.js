import { v4 as uuidv4 } from 'uuid';
import { loadPDFBuffer } from '../../services/pdfService.js';
import { extractDataWithProvider } from '../../services/llmService.js';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { auditLog } from '../../audit/logger.js';

const llmCfg = () => ({
  llmProvider: config.LLM_PROVIDER, ollamaUrl: config.OLLAMA_URL,
  ollamaModel: config.OLLAMA_MODEL, openaiApiKey: config.OPENAI_API_KEY,
  openaiModel: config.OPENAI_MODEL, anthropicApiKey: config.ANTHROPIC_API_KEY,
  anthropicModel: config.ANTHROPIC_MODEL,
});

export async function batchRoutes(app) {
  // POST /api/batch
  // Body: { pdfs: [{filename, pdf_base64}], fields: [...] }
  app.post('/', {
    schema: {
      body: {
        type: 'object', required: ['pdfs', 'fields'],
        properties: {
          pdfs:   { type: 'array', minItems: 1, maxItems: 50 },
          fields: { type: 'array', minItems: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { pdfs, fields } = req.body;
    const batchId = uuidv4();
    const results = [];

    for (const item of pdfs) {
      const { filename = 'document.pdf', pdf_base64 } = item;
      try {
        const buf    = Buffer.from(pdf_base64, 'base64');
        const pdf    = await loadPDFBuffer(buf);
        const result = await extractDataWithProvider(llmCfg(), fields, pdf.chunks.length ? pdf.chunks : [{ text: pdf.text }]);
        results.push({ filename, status: 'ok', result });
        await db.query(
          `INSERT INTO extraction_history (id, user_email, pdf_name, pdf_size_bytes, fields, result, llm_provider)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [uuidv4(), req.user.email, filename, buf.length, JSON.stringify(fields), JSON.stringify(result), config.LLM_PROVIDER]
        );
      } catch (err) {
        results.push({ filename, status: 'error', error: err.message });
      }
    }

    await auditLog({
      userEmail: req.user.email, action: 'batch', result: 'success',
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      details: { batchId, total: pdfs.length, ok: results.filter(r => r.status === 'ok').length },
    });

    return reply.send({ batchId, results });
  });
}
