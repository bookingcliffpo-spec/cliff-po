/** Statuses the provider never moves off again. Kept apart from the client so
    browser code can import it without pulling the server client in. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "nsfw", "canceled"]);
