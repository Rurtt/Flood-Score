// Re-fetch the last 48 hours as Bangkok dates to recover a missed hourly run.
import { serviceClient } from "./db.ts";
import { runIngest } from "./pipeline.ts";
import { createStore } from "./store.ts";
import { bangkokDate } from "./traffy.ts";

const now = Date.now();
const window = { start: bangkokDate(new Date(now - 2 * 86400_000)), end: bangkokDate(new Date(now)) };
const result = await runIngest(createStore(serviceClient()), window);
console.log(JSON.stringify({ window, ...result }));
if (result.status === "failed") process.exitCode = 1;
