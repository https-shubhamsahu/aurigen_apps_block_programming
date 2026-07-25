# Aurigen — Handover

Operational state, known gaps, and open work. For architecture and dev commands
see [CLAUDE.md](CLAUDE.md); for the public project overview see [README.md](README.md).

Last verified: 2026-07-21.

---

## 1. Where everything lives

| Piece | Location | Who controls it |
|---|---|---|
| Frontend | https://aurigen-apps.vercel.app (Vercel project `aurigen-apps`) | Auto-deploys on push to `main` |
| Source | https://github.com/https-shubhamsahu/aurigen_apps_block_programming | `main` is the only branch |
| Backend | Docker Compose on the maintainer's Windows machine | Manual start |
| Public backend URL | Cloudflare **quick tunnel** — hostname changes on every restart | Manual start |
| Database + Auth | Supabase project `voxuhqnntdaohkcyevom` (region ap-south-1) | Supabase dashboard |

Secrets are **not** in git: `backend/.env` (service-role key) and `frontend/.env`
are gitignored. `frontend/.env.production` *is* committed and contains only the
Supabase URL, the anon key (public by design, protected by RLS), and the compile
API URL.

---

## 2. The load-bearing weakness: the backend is not really hosted

The compile service runs in Docker **on a personal machine**, reachable only
through a Cloudflare *quick* tunnel. That means:

- If the machine sleeps, reboots, or Docker stops → **cloud compiles fail for
  everyone**. Guests can still build, simulate, and save; only compiling breaks.
- Every `cloudflared` restart mints a **new random hostname**, which silently
  invalidates the deployed frontend (the URL is baked into the bundle at build
  time). Recovery requires a commit + push + Vercel redeploy.
- This already happened twice during setup. It is not a rare edge case; it is
  the normal consequence of quick tunnels.

**Fixing this properly is the single highest-value piece of remaining work.**
Two documented paths, both free, config already committed:

- **Cloudflare named tunnel** — stable hostname on a domain you own. Needs a
  Cloudflare account: `cloudflared tunnel create` + `cloudflared tunnel route dns`.
  Systemd unit template at `cloudflared.service.example`.
- **Oracle Cloud Always Free VPS** — a real always-on host (4 vCPU / 24 GB ARM,
  non-expiring). Provisioning script at `backend/install.sh` (installs Redis,
  Node 22, arduino-cli + both cores, pm2); HTTPS via the committed `Caddyfile`.

Until then, treat "the site is up" and "compiling works" as two separate facts.

### Recovery runbook — when compiles break

```bash
# 1. Is the backend alive at all?
docker compose ps                      # from the repo root
docker compose up -d                   # start it (Docker Desktop must be running)

# 2. Is the tunnel alive? A new hostname is printed on startup.
cloudflared tunnel --url http://localhost:4000

# 3. Point production at the (new) hostname, then push to redeploy.
#    Edit VITE_COMPILE_API in frontend/.env.production
git commit -am "Update production compile API to the re-minted tunnel URL"
git push origin main

# 4. Verify: 401 means alive and rejecting anonymous calls (correct).
curl -s -o /dev/null -w "%{http_code}\n" -X POST <TUNNEL_URL>/api/compile \
  -H "Content-Type: application/json" -d '{}'
```

After editing `backend/.env`, always `docker compose up -d --force-recreate api`
— a plain restart keeps the stale env (see CLAUDE.md § Deployment topology).

---

## 3. What's left

### Blocking a real launch

1. **Host the backend properly** — §2 above. Everything else is cosmetic next to this.
2. **Add the production URL to Supabase redirect allow-list** — dashboard →
   Authentication → URL Configuration → Redirect URLs → add
   `https://aurigen-apps.vercel.app`. Without it, signup confirmation emails
   sent from production link back to the wrong origin. Password sign-in works
   regardless, which is why this is easy to miss. *(Dashboard-only; cannot be
   done from code.)*
3. **Verify the email confirmation link end-to-end.** Sign-up, sign-in, resend,
   and the unconfirmed-email error path are all verified working, but nobody has
   yet clicked an actual confirmation link from a real inbox. The one test
   account was confirmed by direct SQL, which bypasses exactly the path a real
   student would take.

### Correctness gaps

4. **Uno STK500v1 flashing is untested on physical hardware.** The protocol
   implementation is complete (`hooks/useAvrFlash.js`) and follows the standard
   optiboot handshake, but no real board has ever been flashed with it. ESP32
   flashing *is* verified on-air. Needs a real Uno on USB.
5. **Wire up `frontend/src/ai/` (or delete it).** The module is now correct and
   fully tested, but nothing imports it — it is dead code until a UI calls
   `compileProgram`. See §5 for what was fixed.
6. **Enable Supabase leaked-password protection** — dashboard → Authentication →
   Sign In / Providers → Passwords. One toggle.
7. **Repair WSL so Docker can start.** Docker Desktop currently fails at launch:
   the WSL Store package is installed, but the System32 stub is orphaned —
   `wsl.exe` is present while `C:\Windows\System32\lxss\wslclient.dll` is
   missing, so every `wsl.exe` call dies with "The system cannot find the file
   specified." Windows 11 **Home** has no Hyper-V backend to fall back to, so
   WSL2 must be fixed for the backend to run at all. In an **elevated**
   PowerShell:

   ```powershell
   dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
   dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
   # reboot, then:
   wsl --update
   ```

   Verify with `wsl --status` before starting Docker Desktop.

### Known deliberate trade-offs (not bugs — don't "fix" without cause)

- The **block interpreter is the only ESP32 simulation engine**. No open-source
  ESP32 core exists to embed (Wokwi's is closed). The firmware-accurate engine
  is Uno-only by necessity.
- The **firmware engine runs on the main thread** with a 6 ms/slice budget.
  Worker offload is the natural upgrade, not a correctness issue.
- **Guest projects are per-browser** by definition — they live in `localStorage`
  and migrate to the account on first sign-in.
- The worker exports **all four ESP32 flash artifacts**, not just the app binary.
  This is intentional; flashing only `app@0x10000` boot-loops a factory-fresh
  board. (Note: `boot_app0.bin` is absent on some core versions and is treated
  as non-fatal — a 3-artifact export is normal, not a failure.)
- **CI only syntax-checks the backend** (`node --check`). There is no backend
  test suite and no live Redis/Supabase in CI, so runtime regressions in
  `server.js`/`worker.js` are caught only by running the stack.

---

## 4. Correction to an earlier claim in this file

An earlier revision listed the AI module's XML-escaping test failure as a live
injection vulnerability. **That was wrong**, and the mistake is worth recording
because the test invited it.

The payload `</field><script>alert(1)</script>` *is* correctly escaped — the
generated XML contains `&lt;script&gt;` inside a single `<field>`, loads as
exactly two blocks (`esp32_serial_print` + `text`), and never breaks out. What
the old test actually asserted was that the payload must not appear in the
generated C++ — but it appears there as a **string literal printed over a serial
cable**, which is inert. There is no DOM at the other end of a USB port. The
assertion demanded that a student's legitimate string be silently mangled.

The test now asserts the property that actually matters: the XML carries no live
markup, the block graph has exactly the expected shape, and the field round-trips
byte-for-byte into one `Serial.println` argument.

Lesson: for an escaping boundary, assert on the *structure produced*, not on
whether scary-looking characters survive to the far end.

## 5. History worth knowing

The 2026-07-08 audit found and fixed 8 issues, most notably: stale-firmware
delivery after edits (the Download button stayed "ready" against an outdated
build), non-deterministic ESP32 codegen from a module-global LEDC channel
allocator, and a 1.17 MB initial bundle (now 437 KB / 126 KB gzip via dynamic
imports for esptool-js and avr8js, with Blockly in its own cacheable chunk).
Those are all resolved and regression-tested; details are in the git history
around that date.

A later round of work replaced OAuth (Google/Microsoft) with **email-only auth**
plus a resend-confirmation path, and fixed three Docker bugs that made cloud
compiling fail in ways that all *looked* like auth problems:

- image pinned to Node 20, but supabase-js realtime needs native WebSocket (→ Node 22)
- `python3` missing, which the ESP32 core's build scripts require
- `ARTIFACT_DIR`/`JOB_DIR` pointing off the shared volume, so the worker wrote
  binaries the API couldn't serve — the job reported success and the download 404'd

The lesson worth carrying: **in this stack, a compile failure usually is not an
auth failure**, even when the error says "Invalid or expired session." Check the
container's actual env (`docker exec ... node -e "process.env..."`) before
debugging the token.

Most recently, `frontend/src/ai/` was repaired and committed. It had a real
structural bug: `chain()` spliced `<next>` at the *first* `</block>`, which for
any block with nested children belongs to a descendant, so multi-statement
programs containing an `if`/`repeat`/value-carrying block attached the rest of
the chain to something with no next connection and Blockly refused the whole
workspace. It now anchors on the block's own closing tag. The module is correct
and covered by 7 tests, but still unwired — see §3 item 5.
