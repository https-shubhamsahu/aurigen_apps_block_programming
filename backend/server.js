// ============================================================
// STACK LAYER: Backend / API + Queue Producer (runs on the VPS)
// POST /api/compile        → verify Supabase JWT, enqueue, 202 + jobId
// GET  /api/status/:jobId  → queue state (+ artifact URLs when done)
// GET  /artifacts/*        → static .bin payloads (10-min lifetime)
// ============================================================
// Load ./.env if present (pm2 / bare `node server.js`). Under Docker the
// values arrive via compose env_file and no .env file exists — that's fine.
try { process.loadEnvFile(); } catch { /* no .env file */ }

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createClient } from '@supabase/supabase-js';

const {
  PORT = 4000,
  REDIS_URL = 'redis://127.0.0.1:6379',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ARTIFACT_DIR = '/tmp/aurigen-artifacts',
  CORS_ORIGIN = '*',
  MAX_SOURCE_BYTES = 256 * 1024, // a Blockly sketch should never approach this
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

// Service-role client is used ONLY to validate incoming user JWTs.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// BullMQ requires maxRetriesPerRequest: null on its connections.
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
export const compileQueue = new Queue('compile', {
  connection,
  defaultJobOptions: {
    attempts: 1,                                   // a failed compile is user error, don't retry
    removeOnComplete: { age: 600 },                // 10-min TTL — mirrors artifact cleanup
    removeOnFail: { age: 600 },
  },
});

const app = express();
// CORS_ORIGIN accepts a comma-separated list, e.g.
//   CORS_ORIGIN=https://aurigen-apps.vercel.app,http://localhost:5173
app.use(cors({ origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '512kb' }));

// ---- Auth middleware: Bearer <supabase-jwt> ----------------------
async function requireUser(req, res, next) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session.' });

  req.user = data.user;
  next();
}

// Whitelisted board targets — the client picks a key, never an FQBN.
const BOARD_TARGETS = {
  esp32: 'esp32:esp32:esp32',   // ESP32 DevKit V1
  uno: 'arduino:avr:uno',       // Arduino Uno R3
};

// ---- Abuse protection ---------------------------------------------
// Compiles cost ~10 s of CPU each; a fixed-window per-user limit plus a
// global queue-depth cap keeps one user (or a script) from wedging the box.
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS ?? 60_000);
const RATE_MAX_PER_WINDOW = Number(process.env.RATE_MAX_PER_WINDOW ?? 6);
const MAX_QUEUE_DEPTH = Number(process.env.MAX_QUEUE_DEPTH ?? 50);

const rateBuckets = new Map(); // userId -> { count, resetAt }
function rateLimit(req, res, next) {
  const now = Date.now();
  const bucket = rateBuckets.get(req.user.id);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(req.user.id, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return next();
  }
  if (bucket.count >= RATE_MAX_PER_WINDOW) {
    res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
    return res.status(429).json({ error: 'Too many compiles — wait a minute and try again.' });
  }
  bucket.count += 1;
  next();
}
setInterval(() => { // don't let the bucket map grow unbounded
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now >= v.resetAt) rateBuckets.delete(k);
}, RATE_WINDOW_MS).unref();

// ---- Ingestion ----------------------------------------------------
app.post('/api/compile', requireUser, rateLimit, async (req, res) => {
  const { cpp, board = 'esp32' } = req.body ?? {};

  if (typeof cpp !== 'string' || !cpp.trim()) {
    return res.status(400).json({ error: 'Request body must include a non-empty "cpp" string.' });
  }
  if (Buffer.byteLength(cpp) > MAX_SOURCE_BYTES) {
    return res.status(413).json({ error: 'Source exceeds the size limit.' });
  }
  if (!BOARD_TARGETS[board]) {
    return res.status(400).json({ error: `Unknown board "${board}".` });
  }

  const { waiting = 0, active = 0 } = await compileQueue.getJobCounts('waiting', 'active');
  if (waiting + active >= MAX_QUEUE_DEPTH) {
    return res.status(503).json({ error: 'The compile service is at capacity — try again shortly.' });
  }

  const job = await compileQueue.add('compile-sketch', {
    cpp,
    board,
    fqbn: BOARD_TARGETS[board],
    userId: req.user.id, // stamped for audit + per-user rate limiting later
  });

  // 202: accepted for processing; client polls /api/status/:jobId
  res.status(202).json({ jobId: job.id });
});

// ---- Status polling (frontend hits this every 1.5 s) --------------
app.get('/api/status/:jobId', requireUser, async (req, res) => {
  const job = await compileQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Unknown job — it may have expired.' });

  // Jobs are private: only the submitter may poll them.
  if (job.data.userId !== req.user.id) {
    return res.status(403).json({ error: 'Not your job.' });
  }

  const state = await job.getState(); // waiting|active|completed|failed
  const payload = { jobId: job.id, state };

  if (state === 'completed') {
    // worker.js stores [{offset, url}] as the job's return value
    payload.artifacts = job.returnvalue.artifacts;
  } else if (state === 'failed') {
    // Trimmed arduino-cli stderr → shown verbatim to the student.
    payload.compilerOutput = job.failedReason;
  }

  res.json(payload);
});

// ---- Artifact download (short-lived static dir) --------------------
app.use('/artifacts', express.static(ARTIFACT_DIR, {
  fallthrough: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// Static-middleware misses land here as clean JSON, not an HTML page.
app.use((err, _req, res, _next) => {
  if (err.status === 404) return res.status(404).json({ error: 'Artifact expired or not found.' });
  console.error(err);
  res.status(500).json({ error: 'Internal error.' });
});

app.listen(PORT, () => console.log(`Aurigen compile API on :${PORT}`));
