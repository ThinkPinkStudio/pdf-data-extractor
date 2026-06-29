import * as queueService from '../../services/queueService.js';
import { auditLog } from '../../audit/logger.js';

export async function queueRoutes(app) {
  app.get('/jobs', async (req, reply) => {
    const jobs = await queueService.listJobs({
      status: req.query.status ?? undefined,
      limit:  req.query.limit  ? parseInt(req.query.limit)  : 50,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    });
    return reply.send({ jobs });
  });

  app.post('/jobs', {
    schema: {
      body: {
        type: 'object', required: ['folder_path'],
        properties: {
          folder_path: { type: 'string' },
          config:      { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const job = await queueService.createJob({
      submittedBy: req.user.email,
      folderPath:  req.body.folder_path,
      config:      req.body.config,
    });
    await auditLog({
      userEmail: req.user.email, action: 'queue_job_created', result: 'success',
      resource: req.body.folder_path, ipAddress: req.ip, details: { jobId: job.id },
    });
    return reply.code(201).send(job);
  });

  app.get('/jobs/:id', async (req, reply) => {
    const job = await queueService.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job non trovato' });
    return reply.send(job);
  });

  // PATCH usato dal software scanner per aggiornare lo stato
  app.patch('/jobs/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          status:          { type: 'string', enum: ['processing','completed','failed'] },
          progress:        { type: 'integer' },
          total_files:     { type: 'integer' },
          processed_files: { type: 'integer' },
          result_path:     { type: 'string' },
          error:           { type: 'string' },
          started_at:      { type: 'string' },
          completed_at:    { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const job = await queueService.updateJob(req.params.id, req.body);
    if (!job) return reply.code(404).send({ error: 'Job non trovato' });
    return reply.send(job);
  });

  app.delete('/jobs/:id', async (req, reply) => {
    const job = await queueService.cancelJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job non trovato o già avviato' });
    await auditLog({
      userEmail: req.user.email, action: 'queue_job_cancelled', result: 'success',
      resource: req.params.id, ipAddress: req.ip,
    });
    return reply.send({ cancelled: true, job });
  });

  app.get('/jobs/:id/result', async (req, reply) => {
    const job = await queueService.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job non trovato' });
    if (job.status !== 'completed' || !job.result_path)
      return reply.code(400).send({ error: 'Risultato non disponibile', status: job.status });
    return reply.send({ result_path: job.result_path });
  });
}
