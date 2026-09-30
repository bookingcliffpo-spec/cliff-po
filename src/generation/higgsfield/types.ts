export type QueuedGeneration = {
  status: string;
  requestId: string;
  /** Set when the run finished inside the submit call (the keyless
      providers), so the studio can show it without polling. */
  result?: GenerationStatus;
};

export type GenerationStatus = {
  status: string;
  requestId: string;
  images?: Array<{ url: string }>;
  video?: { url: string };
  /** 0–100 while running, when the provider reports it. */
  progress?: number;
  /** Short label of the current stage ("Denoising", "Decoding"…). */
  phase?: string;
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
