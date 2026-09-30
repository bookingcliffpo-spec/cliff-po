export type QueuedGeneration = {
  status: string;
  requestId: string;
};

export type GenerationStatus = {
  status: string;
  requestId: string;
  images?: Array<{ url: string }>;
  video?: { url: string };
  /** Provider's own failure text, already trimmed. */
  error?: string;
};

/** One request's answer inside a batched status poll. A request that errors
    carries its reason alone, so it cannot lose the answers standing beside it.
    `final` marks errors that polling again cannot fix (the request is unknown
    to the provider, the key was revoked). */
export type StatusResult =
  | { requestId: string; status: GenerationStatus }
  | { requestId: string; error: string; code?: string; final: boolean };
