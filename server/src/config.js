import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  MCP_PORT: z.coerce.number().default(3001),
  BASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ALLOWED_EMAIL_DOMAIN: z.string().min(1),
  MAGIC_LINK_SECRET: z.string().min(16),
  MAGIC_LINK_EXPIRY_MINUTES: z.coerce.number().default(15),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@example.com'),
  API_ALLOWED_IPS: z.string().default('127.0.0.1,::1'),
  MCP_ALLOWED_IPS: z.string().default('127.0.0.1,::1'),
  SESSION_SECRET: z.string().min(32),
  SESSION_MAX_AGE_HOURS: z.coerce.number().default(8),
  LLM_PROVIDER: z.enum(['ollama', 'openai', 'anthropic']).default('ollama'),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.2'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  QUEUE_BEARER_TOKEN: z.string().min(32).optional(),
  LOG_DIR: z.string().default('./data/logs'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('❌  Variabili d\'ambiente mancanti o non valide:');
  for (const [k, msgs] of Object.entries(result.error.flatten().fieldErrors)) {
    console.error(`  ${k}: ${msgs.join(', ')}`);
  }
  process.exit(1);
}

export const config = result.data;
export const apiAllowedIps = config.API_ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean);
export const mcpAllowedIps = config.MCP_ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean);
