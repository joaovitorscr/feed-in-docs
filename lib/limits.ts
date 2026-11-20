/**
 * Time limits for one POST /api/generate request. The route's `maxDuration` is a literal, because
 * Next reads it statically, so keep `RUN_BUDGET_MS + SAVE_BUDGET_MS` at least 5 seconds under it.
 */

/** How long the crawl may run, from the start of the request. */
export const RUN_BUDGET_MS = 240_000;

/** How long saving the result may take, from the end of the crawl. */
export const SAVE_BUDGET_MS = 20_000;

const RUN_BUDGET_MINUTES = Math.round(RUN_BUDGET_MS / 60_000);

/** The run budget as copy: "4 minutes", or "40 seconds" for a budget under a minute. */
export const RUN_BUDGET_LABEL =
  RUN_BUDGET_MS < 60_000
    ? `${Math.round(RUN_BUDGET_MS / 1000)} seconds`
    : `${RUN_BUDGET_MINUTES} ${RUN_BUDGET_MINUTES === 1 ? "minute" : "minutes"}`;
