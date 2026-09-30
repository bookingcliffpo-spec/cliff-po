import { getGenerationStatuses } from "./actions";
import { createPoller } from "./poll";
import { callAction } from "./result";

/** The studio's one poller, wired to the status server action. */
export const studioPoller = createPoller({
  fetchStatuses: (requestIds) => callAction(() => getGenerationStatuses({ requestIds })),
});
