// A stand-in for the generation API, used by the Playwright smoke test.
// It checks the Authorization header, fetches every media URL it is handed
// (as the real provider would), and answers submits and status polls.
import http from "node:http";

const PORT = Number(process.env.MOCK_PROVIDER_PORT ?? 4010);
const EXPECTED_AUTH = `Key ${process.env.MOCK_EXPECTED_KEY ?? "e2e_id:e2e_secret_value_123456"}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const calls = [];
const SUPABASE_KEY = "e2e_supabase_key";
const stored = new Map();
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-upsert",
};
const requests = new Map();
let seq = 0;

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function fetchable(url) {
  try {
    const res = await fetch(url);
    await res.arrayBuffer();
    return res.status;
  } catch {
    return 0;
  }
}

async function supabase(req, res, url) {
  const path = url.pathname.slice("/storage/v1".length);
  const json = (status, body) => {
    res.writeHead(status, { ...CORS, "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method === "GET" && path === "/__uploads") {
    return json(200, [...stored].map(([key, file]) => ({ key, type: file.type, size: file.bytes.length })));
  }
  if (req.method === "POST") {
    await readBody(req);
    if (req.headers.apikey !== SUPABASE_KEY || req.headers.authorization !== `Bearer ${SUPABASE_KEY}`) {
      return json(403, { message: "Invalid key" });
    }
    if (path === "/bucket") return json(200, { name: "studio-uploads" });
    const sign = path.match(/^\/object\/upload\/sign\/(.+)$/);
    if (sign) return json(200, { url: `/object/upload/sign/${sign[1]}?token=e2e-one-time` });
  }
  if (req.method === "PUT") {
    const target = path.match(/^\/object\/upload\/sign\/(.+)$/);
    if (!target || url.searchParams.get("token") !== "e2e-one-time") return json(400, { message: "bad token" });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    stored.set(target[1], { type: req.headers["content-type"], bytes: Buffer.concat(chunks) });
    return json(200, { Key: target[1] });
  }
  if (req.method === "GET") {
    const file = stored.get(path.replace(/^\/object\/public\//, ""));
    if (file) {
      res.writeHead(200, { ...CORS, "content-type": file.type });
      return res.end(file.bytes);
    }
  }
  return json(404, { message: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);

  if (req.method === "GET" && url.pathname === "/asset.png") {
    res.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    return res.end(PNG);
  }
  if (req.method === "GET" && url.pathname === "/__calls") return send(res, 200, calls);
  if (req.method === "POST" && url.pathname === "/__reset") {
    calls.length = 0;
    requests.clear();
    return send(res, 200, { ok: true });
  }

  // Supabase Storage stand-in: bucket creation and signing need the server
  // key; the browser PUTs to the signed URL with only its one-time token.
  if (url.pathname.startsWith("/storage/v1/")) return supabase(req, res, url);

  const body = req.method === "POST" ? await readBody(req) : null;

  // AUTOMATIC1111-compatible local Stable Diffusion API (no key).
  if (req.method === "POST" && url.pathname === "/sdapi/v1/txt2img") {
    calls.push({ method: "POST", path: url.pathname, authorized: true, body, media: {} });
    return send(res, 200, { images: [PNG.toString("base64")] });
  }

  const authorized = req.headers.authorization === EXPECTED_AUTH;
  const call = { method: req.method, path: url.pathname, authorized, body, media: {} };
  calls.push(call);
  if (!authorized) return send(res, 401, { detail: "Unauthorized" });

  const status = url.pathname.match(/^\/requests\/([^/]+)\/status$/);
  if (req.method === "GET" && status) {
    const entry = requests.get(decodeURIComponent(status[1]));
    if (!entry) return send(res, 404, { detail: "Not Found" });
    entry.polls++;
    if (entry.polls < 2) return send(res, 200, { status: "in_progress", request_id: entry.id });
    return send(res, 200, {
      status: "completed",
      request_id: entry.id,
      ...(entry.video ? { video: { url: `${ORIGIN}/asset.png` } } : { images: [{ url: `${ORIGIN}/asset.png` }] }),
    });
  }

  if (req.method === "POST") {
    const prompt = typeof body?.prompt === "string" ? body.prompt : "";
    if (prompt.includes("NO_CREDITS")) return send(res, 402, { detail: "Not enough credits" });
    if (prompt.includes("BAD_SETTINGS")) {
      return send(res, 422, { detail: [{ loc: ["body", "duration"], msg: "must be at most 15" }] });
    }
    for (const key of ["image_url", "end_image_url"]) {
      if (typeof body?.[key] === "string") call.media[key] = await fetchable(body[key]);
    }
    const id = `req_${++seq}`;
    requests.set(id, { id, polls: 0, video: !url.pathname.includes("soul") });
    return send(res, 200, { request_id: id, status: "queued" });
  }

  send(res, 404, { detail: "Not Found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock provider on ${ORIGIN}`);
});
