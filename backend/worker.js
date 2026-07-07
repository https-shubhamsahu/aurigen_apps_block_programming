// ============================================================
// STACK LAYER: Backend / Compile Worker (separate process)
// Pulls jobs from Redis, materializes the sketch on disk, runs
// arduino-cli, stages the .bin artifacts, cleans up after 10 min.
//
// Concurrency is capped so 30 students clicking "Compile" at
// once queue politely instead of OOM-ing a $5 VPS.
// ============================================================
// Load the .env sitting NEXT TO THIS FILE if present (pm2 / bare node) —
// resolved from the module path, not cwd, so process managers can't break it.
// Under Docker the values arrive via compose env_file and no .env exists.
try { process.loadEnvFile(new URL('.env', import.meta.url).pathname); } catch { /* no .env file */ }

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const {
  REDIS_URL = 'redis://127.0.0.1:6379',
  ARTIFACT_DIR = '/tmp/aurigen-artifacts',
  JOB_DIR = '/tmp/aurigen-jobs',
  ARDUINO_CLI = 'arduino-cli',            // absolute path in production
  FQBN = 'esp32:esp32:esp32',             // ESP32 DevKit V1
  CONCURRENCY = 2,                         // ~1 compile per vCPU
  COMPILE_TIMEOUT_MS = 180_000,
  ARTIFACT_TTL_MS = 10 * 60 * 1000,        // spec: wipe after 10 minutes
} = process.env;

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

// Per-board artifact staging.
//  * esp32 — all four flash images (not just the app) so even a
//    factory-erased board flashes to a booting state.
//  * uno — a single .hex; the browser can't speak STK500 yet, so
//    the frontend offers it as a download instead of flashing.
const ARTIFACT_MAPS = {
  esp32: [
    { suffix: '.ino.bootloader.bin', offset: 0x1000 },
    { suffix: '.ino.partitions.bin', offset: 0x8000 },
    { file: 'boot_app0.bin',         offset: 0xe000 }, // shipped with the esp32 core
    { suffix: '.ino.bin',            offset: 0x10000, required: true }, // the student's program
  ],
  uno: [
    { suffix: '.ino.hex', offset: 0, required: true },
  ],
};

new Worker(
  'compile',
  async (job) => {
    const { cpp, board = 'esp32', fqbn = FQBN } = job.data;
    // arduino-cli requires <dir>/<dir>.ino name parity.
    const sketchName = `job_${job.id}`;
    const sketchDir = path.join(JOB_DIR, sketchName);
    const buildDir = path.join(sketchDir, 'build');

    try {
      await fs.mkdir(sketchDir, { recursive: true });
      await fs.writeFile(path.join(sketchDir, `${sketchName}.ino`), cpp, 'utf8');

      // execFile (no shell) → the C++ payload can never inject into the
      // command line. It is compiled, never executed, on this machine.
      try {
        await execFileAsync(
          ARDUINO_CLI,
          ['compile', '-b', fqbn, '--output-dir', buildDir, sketchDir],
          { timeout: Number(COMPILE_TIMEOUT_MS), maxBuffer: 8 * 1024 * 1024 }
        );
      } catch (err) {
        if (err.killed) throw new Error('Compilation timed out. Simplify the program and retry.');
        // Surface only the useful tail of stderr to the student.
        throw new Error(trimCompilerError(err.stderr ?? err.message));
      }

      // ---- Stage artifacts into the static download dir ----
      // BullMQ job ids are sequential integers; the random token keeps
      // artifact URLs from being enumerable by other users.
      const token = randomBytes(8).toString('hex');
      const artifacts = [];
      for (const spec of ARTIFACT_MAPS[board] ?? ARTIFACT_MAPS.esp32) {
        const srcName = spec.file ?? `${sketchName}${spec.suffix}`;
        const src = path.join(buildDir, srcName);
        try {
          await fs.access(src);
        } catch {
          if (spec.required) throw new Error('Build finished but no firmware image was produced.');
          continue; // bootloader/boot_app0 may be absent on some core versions — non-fatal
        }
        const ext = path.extname(srcName); // .bin or .hex
        const publicName = `${sketchName}_${token}_${spec.offset.toString(16)}${ext}`;
        await fs.copyFile(src, path.join(ARTIFACT_DIR, publicName));
        artifacts.push({ offset: spec.offset, url: `/artifacts/${publicName}` });
      }

      return { artifacts }; // read back by GET /api/status/:jobId
    } finally {
      // Sketch + build tree are useless once artifacts are staged.
      await fs.rm(sketchDir, { recursive: true, force: true }).catch(() => {});
    }
  },
  { connection, concurrency: Number(CONCURRENCY) }
);

/** Keep the last error-dense lines; a full ESP32 build log is megabytes. */
function trimCompilerError(stderr) {
  const lines = stderr.split('\n').filter(Boolean);
  const errors = lines.filter((l) => /error:|fatal/i.test(l));
  return (errors.length ? errors : lines).slice(-15).join('\n');
}

// ---- Cleanup sweep: enforce the 10-minute artifact TTL -----------
setInterval(async () => {
  try {
    const now = Date.now();
    for (const name of await fs.readdir(ARTIFACT_DIR)) {
      const full = path.join(ARTIFACT_DIR, name);
      const { mtimeMs } = await fs.stat(full);
      if (now - mtimeMs > Number(ARTIFACT_TTL_MS)) {
        await fs.rm(full, { force: true });
      }
    }
  } catch (e) {
    console.error('cleanup sweep failed:', e.message);
  }
}, 60_000);

await fs.mkdir(ARTIFACT_DIR, { recursive: true });
await fs.mkdir(JOB_DIR, { recursive: true });
console.log(`Compile worker up — concurrency ${CONCURRENCY}, FQBN ${FQBN}`);
