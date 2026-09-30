# Architecture notes

## One request, end to end

```
Composer ──assemblePlane()──▶ { model, prompt, media, settings }
   │
   │ callAction(() => submitGeneration(plane))        (server action)
   ▼
service.submitPlane
   ├─ validatePlane      catalog lookup, strict settings, per-role caps,
   │                     media URLs must be public http(s)
   ├─ adapters.toPlatform model → { path, body } in the provider's fields
   ├─ resolveCredentials  HF_API_KEY ▸ browser cookie key; HF_API_BASE_URL
   └─ higgsfield.submit   POST {base}/{path}, Authorization: Key <id:secret>
   │
   ◀── ActionResult<{ requestId, status }>
   │
Studio opens "running" rows keyed by requestId
   │
studioPoller.watch(requestId, deadline)
   │  every 4 s, one batched action for every request in flight:
   │  callAction(() => getGenerationStatuses({ requestIds }))
   ▼
service.pollStatuses ── GET {base}/requests/{id}/status (parallel)
   ◀── ActionResult<StatusResult[]>   per request: status, or { error, code, final }
   │
terminal status ▸ rows replaced by completed/failed records ▸ IndexedDB
```

## Error contract

`src/generation/result.ts`

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; code?: ErrorCode };
```

- **Server actions never throw.** Each wraps its body and converts anything
  caught with `toFailure()`. Only `GenerationError` messages are passed
  through (they are written to be shown); any other exception becomes a
  generic message, because an arbitrary `Error.message` can carry URLs,
  headers or keys. Messages are also run through `redact()`.
- **The client never trusts the transport.** `callAction()` turns a rejected
  action call (offline, a redeploy that removed the action id) into
  `{ ok: false, code: "network_error" }` and validates the shape of what came
  back. No unhandled rejections escape from generate, poll, key or upload
  flows.
- **Behaviour keys off `code`, not text.** The studio opens the key modal on
  `missing_api_key` / `invalid_api_key` (unless the key is the server's), and
  the poller settles all watches at once on a fatal round
  (`missing_api_key`, `invalid_api_key`, `missing_config`, `forbidden`).

Provider status → code mapping lives in `higgsfield/provider-errors.ts`:

| HTTP | code | retried? |
| --- | --- | --- |
| 401, 403 naming the key | `invalid_api_key` | no |
| 403 | `forbidden` | no |
| 402, or a credits/balance message | `insufficient_balance` | no |
| 404 | `invalid_model` (submit) / `not_found` (status, final) | no |
| 400, 422 | `unsupported_settings` with the provider's detail | no |
| 408, 504, client timeout | `timeout` | status polls only |
| 429 | `rate_limited` | yes, honouring `Retry-After` ≤ 8 s |
| 5xx | `provider_unavailable` | status polls only |
| network failure | `network_error` | status polls only |

A submit (POST) is repeated **only** after a 429: any other failure may have
reached the provider and started a paid run.

## Credentials

- `HF_API_KEY` (server env) is preferred; a key pasted in the studio is stored
  in an httpOnly, SameSite=Lax cookie and used only when no server key exists.
- The key is read on the server per request, formatted by
  `toAuthorizationHeader()` as `Key <id:secret>`, and never returned to the
  browser. `getStudioStatus()` reports only *which* source is in use.
- The client logs `[higgsfield] METHOD path status duration` and nothing else
  — no headers, no bodies.
- `APP_PASSWORD` (checked in `proxy.ts`, constant-time comparison) protects
  every route except `/api/media/*` (the provider must fetch inputs) and
  `/api/health` (booleans only).

## Catalog and adapters

- `catalog/` is the source of truth: each entry declares its surface, media
  roles with caps, and settings (`enum` / `range` / `boolean`). The composer
  renders exactly those controls.
- `parseSettings(model, raw, "strict" | "lenient")`: the server rejects any
  value outside the allow-list (and non-integer values for ranges without a
  step); the UI falls back to defaults so a stale persisted value cannot crash
  a render.
- `adapters/index.ts` maps each model id to a provider request. Soul, Kling 3
  and Seedance have dedicated mappers; the rest use `paths` + the shared
  mapper.
- `adapters/seedance.ts` — Seedance 2.0 / Fast / Mini / 2.5, 2.5 Edit and
  Extend. Mode is derived from inputs:
  - start frame (+ optional end frame) → `…/image-to-video` (`image_url`,
    `end_image_url`; no `aspect_ratio`)
  - reference images / videos / audio → `…/reference-to-video`
    (`image_urls`, `video_urls`, `audio_urls`, `aspect_ratio`)
  - nothing → `…/text-to-video` (`aspect_ratio`)
  - shared: `prompt`, `resolution` (480p/720p on 2.5), `duration` (4–30 s on
    2.5, 4–15 s on 2.0), `generate_audio`, `output_format` (mp4/mov on 2.5)
  - refused with a message instead of silently dropped: an end frame without
    a start frame; frames together with references; audio references alone;
    Edit/Extend without exactly one source video.

## Polling

`poll.ts` exports `createPoller(deps)`; `poller.ts` wires the studio's
instance to the status action.

- One timer, one batched request per interval for every watched id; repeated
  `watch()` calls for an id share one promise.
- Per-request results: terminal status resolves; a `final` error rejects; a
  transient error waits for the next round.
- A round that fails with a fatal code settles everything; four failed rounds
  in a row settle everything; a deadline sweep runs after **every** round,
  successful or not, so nothing can stay "running" past its deadline.
- `stop()` (unmount) rejects all watches with `canceled` and invalidates any
  round already awaiting the server, so a late answer cannot land in the next
  mount. The next mount resumes "running" rows from IndexedDB.

## Client state

- Five small persisted Zustand stores (active model/surface/batch, image and
  video prompt, image and video media, settings by model) are created with
  `skipHydration` and rehydrated by `useHydrateStores()` after mount, so the
  server HTML and the first client render match.
- History and the uploads shelf live in IndexedDB (localStorage mirror for
  older browsers). One effect writes history; state updaters are pure.
- Duplicate protection: rows are keyed by the submitted request id; a
  request's rows are replaced, never stacked; the same plane pressed twice
  inside 800 ms is ignored; auto-repeat of ⌘/Ctrl+Enter is ignored.

## Uploads

`media-rules.ts` is shared by the browser and the server:

| kind | types | max |
| --- | --- | --- |
| image | JPEG, PNG, WebP, GIF | 20 MB |
| video | MP4 | 200 MB |
| audio | WAV | 30 MB |

- Vercel Blob: `/api/blob` issues a client token bound to the declared content
  type and that type's size cap; the browser uploads directly with progress
  (`onUploadProgress`), multipart above 32 MB.
- Local: `/api/upload` streams the body to disk, aborting as soon as it
  exceeds the cap; files are named `<32 hex>.<ext>` and served by
  `/api/media/[name]` with `nosniff` and immutable caching.
- Submit validation refuses `blob:`/`data:` URLs and (unless
  `ALLOW_PRIVATE_MEDIA_URLS=true`) private hosts, with an "Upload failed"
  message, before any request is paid for.

## Testing

- `tests/unit` (Vitest): credentials and config, Authorization header, provider
  error parsing and redaction, Seedance mapping and validation, upload
  validation and the local driver, the provider client (timeouts, abort,
  retry policy), the service layer (submit success/failure, missing config,
  key precedence), and the poller (completion, timeout, fatal rounds,
  cancellation).
- `tests/e2e` (Playwright): builds the production app and runs it against
  `tests/e2e/mock-provider.mjs`, covering the full generate → poll → gallery
  flow, safe error display, an upload used as a Seedance start frame (fetched
  by the mock provider), the password gate, and mobile dialogs.
