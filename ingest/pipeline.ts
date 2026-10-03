import { fetchTraffy, type FetchOptions, type FloodRow, type Window } from "./traffy.ts";

export const BATCH_SIZE = 500;
export const MAX_REJECT_RATE = 0.2;
export type RunResult = { status: "ok" | "partial" | "failed"; rowsUpserted: number; rowsRejected: number; error: string | null };
export type Store = {
  startRun(window: Window): Promise<number>;
  upsert(rows: FloodRow[]): Promise<void>;
  refresh(): Promise<void>;
  finishRun(id: number, result: RunResult): Promise<void>;
};

export async function runIngest(store: Store, window: Window, opts: FetchOptions = {}): Promise<RunResult> {
  const runId = await store.startRun(window);
  let upserted = 0;
  let rejected = 0;
  let result: RunResult;
  try {
    const fetched = await fetchTraffy(window, opts);
    rejected = fetched.rejected;
    const seen = fetched.rows.length + rejected;
    if (seen > 0 && rejected / seen > MAX_REJECT_RATE) {
      result = { status: "failed", rowsUpserted: 0, rowsRejected: rejected, error: `rejected ${rejected} of ${seen} features (over 20%); nothing written` };
    } else {
      for (let i = 0; i < fetched.rows.length; i += BATCH_SIZE) {
        const batch = fetched.rows.slice(i, i + BATCH_SIZE);
        await store.upsert(batch);
        upserted += batch.length;
      }
      if (upserted > 0) await store.refresh();
      result = { status: fetched.complete ? "ok" : "partial", rowsUpserted: upserted, rowsRejected: rejected, error: fetched.complete ? null : `got ${seen} of ${fetched.total} features Traffy reported` };
    }
  } catch (error) {
    result = { status: "failed", rowsUpserted: upserted, rowsRejected: rejected, error: error instanceof Error ? error.message : String(error) };
  }
  // Bookkeeping failures must propagate so callers cannot report a successfully closed run.
  await store.finishRun(runId, result);
  return result;
}
