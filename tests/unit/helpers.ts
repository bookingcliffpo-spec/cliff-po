export const API_KEY = "key_id_1234:fake_secret_value_abcdefghijklmnop";

export type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fetch stand-in that records every call and answers from a queue. */
export function fakeFetch(
  answers: Array<Response | Error | ((call: Call, init?: RequestInit) => Response | Promise<Response>)>,
) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const next = answers.shift();
    if (!next) throw new Error("fakeFetch: no answer queued");
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(call, init);
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export const noSleep = async () => {};
