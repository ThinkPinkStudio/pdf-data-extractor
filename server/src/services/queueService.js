import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';

export async function createJob({ submittedBy, folderPath, config: jobConfig }) {
  const id = uuidv4();
  const { rows } = await db.query(
    `INSERT INTO queue_jobs (id, submitted_by, folder_path, config)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, submittedBy, folderPath, JSON.stringify(jobConfig ?? {})]
  );
  return rows[0];
}

export async function listJobs({ status, limit = 50, offset = 0 } = {}) {
  if (status) {
    const { rows } = await db.query(
      `SELECT * FROM queue_jobs WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );
    return rows;
  }
  const { rows } = await db.query(
    `SELECT * FROM queue_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

export async function getJob(id) {
  const { rows } = await db.query(`SELECT * FROM queue_jobs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function updateJob(id, updates) {
  const allowed = ['status','started_at','completed_at','result_path','error','progress','total_files','processed_files'];
  const fields  = Object.keys(updates).filter(k => allowed.includes(k));
  if (!fields.length) return null;
  const set    = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map(f => updates[f]);
  const { rows } = await db.query(
    `UPDATE queue_jobs SET ${set} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return rows[0] ?? null;
}

export async function cancelJob(id) {
  const { rows } = await db.query(
    `UPDATE queue_jobs SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}
