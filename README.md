# OpenHiggsfield Studio — personal fork

A self-hosted image and video generation studio: one prompt bar, 38 models,
each model's own settings, and every finished run in one gallery. This is a
personal fork of [wide-trace/open-higgsfield](https://github.com/wide-trace/open-higgsfield)
(imported at `b16a0ef`) with the reliability and security fixes described
below. The UX — the dark studio, Image / Video / Assets / Favorites, the
composer, model picker, per-model settings, batch, gallery, viewer,
reuse/retry, download, delete + undo — is kept as upstream built it.

> **Cost.** The studio runs with **no API key at all** in free mode (below). The
> 38 Higgsfield models are billed by the provider to the key in use. Storage is
> either Vercel Blob (has a free tier, paid beyond it) or your own server's disk
> (free).

---

## Free mode — no API key

Run it with nothing configured and the studio opens in **Free mode** (the
topbar says so), offering only the models that need no key:

| Model | What it is | Cost / limits |
| --- | --- | --- |
| **Flux · Free**, **Turbo · Free** | Real AI images from [Pollinations](https://pollinations.ai), a free public service. The server builds the image URL; your browser loads it. | Free, no signup. Rate-limited and shared; quality and uptime are theirs, not guaranteed. Prompts are sent to Pollinations. |
| **Stable Diffusion · Local GPU** | Your own [AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui) / Forge / SD.Next server started with `--api`. Set `LOCAL_SD_URL`. | Free and unlimited, fully private — needs a capable GPU (≈8 GB VRAM for SDXL). |
| **Demo · Offline** | Placeholder art drawn by this server, stamped "DEMO · NOT AI". | Free, works with no network. For trying the studio, not for real images. |

Everything else — batch, gallery, favorites, reuse, download, delete + undo,
history — works the same in free mode.

**Video is free on your own GPU** through WanGP (next section). No hosted
service offers free, keyless video, so without a GPU video needs `HF_API_KEY`.

```bash
pnpm install
pnpm build && pnpm start      # http://localhost:3000 — no .env needed
```

Local Stable Diffusion, on the same machine as a GPU:

```bash
./webui.sh --api              # AUTOMATIC1111 / Forge, listens on :7860
LOCAL_SD_URL=http://127.0.0.1:7860 pnpm start
```

Turn the hosted or demo models off with `FREE_PROVIDERS` (e.g.
`FREE_PROVIDERS=demo`, or empty for none). Adding `HF_API_BASE_URL` +
`HF_API_KEY` later unlocks the paid models alongside the free ones.

Next.js 16 App Router · React 19 · plain CSS · Zustand · pnpm

---

## Free video on your GPU — WanGP

[WanGP](https://github.com/deepbeepmeep/Wan2GP) runs open video models
(LTX-2.3, Wan 2.2, Kiwi-Edit…) on consumer GPUs. `bridge/wangp_bridge.py`
drives WanGP through its documented Python API (`shared.api`: `init`,
`submit_task`, progress events, `cancel`) and gives the studio a small
authenticated HTTP job API. The studio's Video tab then offers:

| Studio model | Higgsfield equivalent | WanGP model (override with `WANGP_MODEL_<ACTION>`) |
| --- | --- | --- |
| **Cinema Video · Free GPU** | Seedance 2.5 text-to-video, image-to-video, start + end frame, native audio, audio reference | `ltx2_22B_distilled` (LTX-2.3 makes the soundtrack in the same pass) |
| **Reference to Video · Free GPU** | Seedance reference-to-video (character / face / product / wardrobe / location / style refs) | `ltx2_22B_msr` (up to 5 references; a *location* ref becomes the background) |
| **Video Edit · Free GPU** | Seedance Video Edit + Regional Edit | `kiwi_edit` with a reference, `kiwi_edit_instruct_only` without |
| **Video Extend · Free GPU** | Forward / Backward Extend | `ltx2_22B_distilled` continuation; backward = reverse → continue → reverse |
| **Motion Transfer · Free GPU** | Genjutsu Motion Transfer / character replacement | `animate` (Wan 2.2 Animate: animate your character, or replace the person) |
| **Swap & Restyle · Free GPU** | Genjutsu Object Swap: character, face, product, wardrobe, location, object + 26 promptless style/scene presets, keep motion / camera / timing / background | `ltx2_22B_distilled_edit_anything` with a reference, Kiwi-Edit without |

Every video model (paid or free) also gets the **Director's Panel** —
genre, era, tempo, camera body (35mm, 8mm, DV camcorder…), lens, aperture,
24 camera moves (POV, robot arm, helicopter…), 52 color palettes, 6 lighting
presets, custom light color, brightness, diffusion, light angle and emotion
strength — compiled into the prompt, with a live preview. Runs show live
progress and can be **canceled**; failed runs can be reused and re-rolled.

Setup, on the machine with the GPU:

```bash
# 1. Install WanGP (see its README) and check it works in its own UI once.
# 2. Start the bridge with WanGP's Python environment:
python bridge/wangp_bridge.py --wangp-root /path/to/Wan2GP --token <long-random-secret> \
    --wangp-args "--attention sdpa --profile 4"
# 3. Point the studio at it:
WANGP_URL=http://127.0.0.1:7870 WANGP_TOKEN=<same-secret> pnpm start
```

For uploads (start frames, reference images, source clips) the bridge must be
able to download the file: running the studio on the same machine with
`STORAGE_DRIVER=local PUBLIC_BASE_URL=http://127.0.0.1:3000` works.

Using a hosted studio (e.g. Vercel) with WanGP at home: expose the bridge
with a free tunnel such as `cloudflared tunnel --url http://127.0.0.1:7870`,
keep `--token` set, and set `WANGP_URL` / `WANGP_TOKEN` in the hosting
environment.

Honest limits: speed and quality depend on your GPU (LTX-2.3 distilled wants
~12 GB+ VRAM; quantized variants go lower — see WanGP's docs). Motion
"replace the person" mode and instruction-based swaps are best-effort; hard
cases need WanGP's own mask editor. Higgsfield-only features with no open
equivalent here: high-bitrate output and Higgsfield's hosted regional
re-roll. This product uses WanGP; WanGP's terms apply.

Try the bridge without WanGP or a GPU: `python bridge/wangp_bridge.py --fake`.

---

## What this fork changes

| Problem upstream | Fix |
| --- | --- |
| **"Minified React error"** instead of the real reason a run failed. Server actions threw, and production React replaces a thrown error's message with an opaque digest. | Every server action returns `ActionResult<T>` — `{ ok: true, data } \| { ok: false, error, status?, code? }`. Provider failures are converted **on the server** into safe messages (Invalid API key, Insufficient provider balance, Missing HF_API_BASE_URL, Invalid model, Unsupported settings, Upload failed, Provider timeout, Rate limited). Nothing depends on `Error.message` crossing the boundary. |
| Key only ever came from a browser cookie. | `HF_API_KEY` server secret (preferred), with the browser key as a fallback. The key is never sent to the browser or logged. |
| Anyone with the URL could spend the key. | `APP_PASSWORD` puts the studio behind HTTP Basic auth. |
| Request/response bodies logged in full. | Logs carry method, path, status and duration only; errors are redacted of anything credential-shaped. |
| Undefined env vars failed opaquely. | `HF_API_BASE_URL`, `HF_API_KEY` and storage variables are validated and reported **by name**. |
| No timeouts, no retry policy. | Provider client with per-call timeouts, `AbortSignal`, safe JSON/text parsing, 401/402/403/404/422/429/5xx mapping, and retries only where safe (status polls on transient errors; submits only on 429 so a run is never double-billed). |
| Hydration mismatch: persisted stores read `localStorage` during the first render. | Stores hydrate after mount. |
| Stale polling / jobs stuck "running" forever. | Poller with per-surface deadlines (image 10 min, video 25 min), final-vs-transient errors, a fatal-round path for key/config errors, and cancel-on-unmount. |
| Duplicate records / races. | Rows keyed by the submitted request id; a request's rows replace rather than stack; a double-click or held ⌘/Ctrl+Enter is not a second paid run; history has one writer; undo of a running tile re-attaches its watch. |
| A stale saved setting crashed the composer during render. | Lenient settings parsing in the UI, strict on the server. |
| Uploads had no size limits or progress; errors were bare 500s. | Shared type/size allow-list checked in the browser, by the Blob token, and by the server; progress ring; JSON errors; a free **local-disk** storage driver. |
| Mobile dialogs could overflow the screen under the keyboard; iOS zoomed into inputs. | Dialogs cap at the viewport, scroll inside, lock the page; 16px inputs on small screens. |
| No tests, no lint. | ESLint, 112 unit/integration tests, a Playwright e2e suite against a mocked provider on the production build, and CI. |

---

## Quick start (local)

Requirements: Node.js 22+, pnpm 10+.

```bash
pnpm install
cp .env.example .env.local     # then edit .env.local — it is gitignored
pnpm dev                       # http://localhost:3000
```

Minimum `.env.local` to generate from the prompt alone:

```bash
HF_API_BASE_URL=https://<generation-api-origin>
HF_API_KEY=<id>:<secret>
```

To attach images/video/audio you also need storage (see below). Check the
configuration at any time:

```bash
curl -s localhost:3000/api/health
# {"providerConfigured":true,"storageConfigured":false}
```

`/api/health` only ever returns these two booleans — never a value.

---

## Environment

All variables are server-only. None is exposed to the browser.

| Variable | Required | Purpose |
| --- | --- | --- |
| `FREE_PROVIDERS` | optional | Keyless providers to offer: `pollinations,demo` by default; empty for none. |
| `POLLINATIONS_IMAGE_URL` | optional | Pollinations image endpoint (default `https://image.pollinations.ai/prompt/`). |
| `LOCAL_SD_URL` | optional | AUTOMATIC1111-compatible Stable Diffusion API (started with `--api`). Enables the local GPU model. |
| `HF_API_BASE_URL` | for paid models | Generation API origin. Submit: `POST {base}/{model-path}`; status: `GET {base}/requests/{id}/status`. |
| `HF_API_KEY` | for paid models | Server key, `id:secret`, sent as `Authorization: Key <id:secret>`. Wins over a key saved in the browser. Leave empty to let each visitor paste their own key. |
| `APP_PASSWORD` | when public | HTTP Basic auth for the whole studio (any username). **Set this whenever `HF_API_KEY` is set on a reachable deployment.** `/api/media/*` and `/api/health` stay public. |
| `OPEN_HIGGSFIELD_READ_WRITE_TOKEN` or `BLOB_READ_WRITE_TOKEN` | for uploads (Blob) | Vercel Blob read-write token. |
| `STORAGE_DRIVER` | optional | `vercel-blob` or `local`. Unset: Blob when its token is present. |
| `PUBLIC_BASE_URL` | for `local` | Public origin the provider fetches uploads from, e.g. `https://studio.example.com`. |
| `LOCAL_UPLOAD_DIR` | optional | Directory for `local` uploads (default `.uploads`). |
| `ALLOW_PRIVATE_MEDIA_URLS` | dev only | `true` allows localhost/private media URLs (for a mock provider). The real provider cannot fetch them. |
| `NEXT_PUBLIC_SITE_URL` | optional | Canonical origin for metadata. |

### Storage

Providers fetch inputs from the public internet, so uploads must become
publicly reachable URLs — `blob:` previews are never sent.

- **Vercel Blob** — browser uploads directly to Blob with a token the server
  scopes to one content type and that type's size cap. Works on serverless.
- **Local disk** (`STORAGE_DRIVER=local`) — the browser sends the file to
  `/api/upload`, the server streams it to `LOCAL_UPLOAD_DIR` under a random
  128-bit name and serves it from `/api/media/<name>`. Free; needs a long-lived
  server with a persistent disk and a public `PUBLIC_BASE_URL`. **Not for
  Vercel/serverless** (the filesystem there is ephemeral).

Accepted inputs: JPEG/PNG/WebP/GIF images up to 20 MB, MP4 video up to
200 MB, WAV audio up to 30 MB.

---

## Deployment

### Vercel

1. Import the repository in Vercel (framework: Next.js; install `pnpm install`,
   build `pnpm build`).
2. Create a Blob store (Storage → Blob) and connect it to the project; that sets
   `BLOB_READ_WRITE_TOKEN`.
3. Add environment variables (Production and Preview): `HF_API_BASE_URL`,
   `HF_API_KEY`, `APP_PASSWORD`.
4. Deploy, then open `https://<deployment>/api/health` — both values should be
   `true`.

Every server call is short — a submit waits at most 60 s for the provider,
a status poll at most 20 s — and long video runs are polled from the browser,
so no function needs an extended timeout.

### Self-hosted (any Node 22 host)

```bash
pnpm install --frozen-lockfile
pnpm build
HF_API_BASE_URL=... HF_API_KEY=... APP_PASSWORD=... \
STORAGE_DRIVER=local PUBLIC_BASE_URL=https://studio.example.com \
pnpm start -p 3000
```

Run it under a process manager (systemd, pm2) behind a TLS reverse proxy
(Caddy, nginx) that forwards to port 3000. Keep `LOCAL_UPLOAD_DIR` on a
persistent volume and back it up if you care about old inputs. Put secrets in
the process manager's environment file with restrictive permissions, not in
the repository.

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server on port 3000 |
| `pnpm build` / `pnpm start` | Production build / serve it |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint (Next core-web-vitals + TypeScript) |
| `pnpm test` | Unit and integration tests (Vitest) |
| `pnpm test:e2e` | Builds for production and runs the Playwright smoke test against a mock provider (no real key needed) |
| `pnpm check` | typecheck + lint + test + build |
| `pnpm brand` | Rebuild icons and the OG card in `public/` |

---

## Troubleshooting

| You see | Cause and fix |
| --- | --- |
| `Missing HF_API_BASE_URL — set the generation API origin on the server.` | The variable is unset in the server environment. Set it and restart / redeploy. |
| `HF_API_BASE_URL is not a valid http(s) URL.` | Include the scheme, e.g. `https://…`; no username/password in the URL. |
| `HF_API_KEY is malformed — it must be id:secret.` | The value has no colon, an empty half, or whitespace inside. |
| `No API key configured…` / key modal opens | Neither `HF_API_KEY` nor a browser key is set and free mode is off. |
| `Invalid API key — the provider rejected the credential.` | 401 (or 403 naming the key) from the provider. Check the key is current and complete. |
| `Access denied — this API key is not allowed…` | 403: the key works but lacks access to that model. |
| `Insufficient provider balance…` | 402 or a credits/balance error: top up with the provider. |
| `Rate limited by the provider…` | 429 after the client's own retry. Wait and retry; lower the batch size. |
| `Unsupported settings — …` | The provider (or the catalog check before it) rejected a setting or input combination; the detail names it — e.g. Seedance takes a start/end frame *or* references, not both. |
| `Invalid model — …` | Unknown model id or a provider path that does not exist (404). |
| `Provider timeout — …` | No response within the call timeout, or a run that did not finish within its deadline (image 10 min, video 25 min). It may still complete in the provider dashboard. |
| `Upload failed — … is not supported` / `… can be up to …` | Wrong type or too large; see accepted inputs above. |
| `Upload failed — Vercel Blob is not configured…` | Set a Blob token or `STORAGE_DRIVER=local` + `PUBLIC_BASE_URL`. `/api/health` shows `storageConfigured`. |
| `Upload failed — an input is hosted on a private address…` | `PUBLIC_BASE_URL` points at localhost/LAN; the provider cannot fetch it. Use a public origin (or a tunnel) — or `ALLOW_PRIVATE_MEDIA_URLS=true` only with a mock provider. |
| Free Flux/Turbo tiles stay blank or broken | Pollinations is rate-limiting or down, or your network blocks `image.pollinations.ai`. Wait and retry, or use Local GPU / Demo. |
| `Could not reach the local Stable Diffusion server…` | Start it with `--api` and check `LOCAL_SD_URL` is reachable from the studio server. |
| `Video needs a provider key…` | Expected in free mode — there is no free video model. |
| `This model needs an API key…` | You picked a paid model with no key; pick a free one or add a key. |
| `WanGP is not connected…` | Set `WANGP_URL` (and `WANGP_TOKEN`) to the running bridge. |
| `Could not reach the WanGP bridge…` | The bridge is down, or the studio server cannot reach it (tunnel down, wrong port). `curl $WANGP_URL/v1/health`. |
| `The WanGP bridge rejected the token` | `WANGP_TOKEN` differs from the bridge's `--token`. |
| A GPU run fails with a WanGP message (e.g. out of memory) | Lower resolution/duration, pick a quantized model via `WANGP_MODEL_*`, or a lower-VRAM `--profile` in `--wangp-args`. |
| `Could not download an input` (GPU run) | The bridge cannot fetch the uploaded file — use local storage with a `PUBLIC_BASE_URL` the bridge can reach. |
| Browser asks for a username/password | `APP_PASSWORD` is set: any username, that password. |
| Old runs show blank tiles | Result URLs belong to the provider's CDN and can expire; history is kept per browser in IndexedDB. |

Server logs never contain the key, the Authorization header, or request bodies;
look for `[higgsfield] POST /… 402 812ms`-style lines.

---

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). In one paragraph: the UI
builds one plane `{ model, prompt, media, settings }` and hands it to the
`submitGeneration` server action; the server re-validates it against the
catalog, maps it to the provider's fields in `src/generation/adapters/`, and
submits it through `src/generation/higgsfield/client.ts`. The browser polls
every run in flight with one batched `getGenerationStatuses` action every 4 s
until a terminal status or the deadline. Every action returns an
`ActionResult`; nothing is thrown across the boundary.

```
src/
  app/                 the studio page, /api/blob, /api/upload, /api/media/[name], /api/health
  proxy.ts             APP_PASSWORD gate + device cookie
  generation/
    actions.ts         server actions (all return ActionResult)
    service.ts         submit/poll logic, testable without Next
    higgsfield/        provider client, error mapping, response types
    free/              keyless providers: Pollinations, local Stable Diffusion, demo art
    adapters/          model → provider request mapping (seedance.ts, …)
    catalog/           model entries: settings, media roles, paths
    storage/           storage config + local-disk driver
    poll.ts            batched client-side poller
  openhiggsfield/      the studio UI and openhiggsfield.css
tests/unit             Vitest
tests/e2e              Playwright + mock provider
legacy/harlem-empire   an unrelated prototype that previously lived at the repo root
```

---

## License

The upstream repository ships **no license file**, which means its code is
all-rights-reserved by default even though it is publicly visible. This fork is
kept as a personal copy; see [`NOTICE.md`](NOTICE.md) before redistributing or
publishing it. All dependencies added by this fork (ESLint, Vitest,
Playwright, server-only) are MIT or Apache-2.0.
