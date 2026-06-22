import { mkdir } from 'fs/promises';
import { config } from '../config.js';

export async function ensureDirectories() {
  await mkdir(config.LOG_DIR,    { recursive: true });
  await mkdir(config.UPLOAD_DIR, { recursive: true });
}
