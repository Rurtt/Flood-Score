// Historical reports use the same validation and idempotent pipeline as hourly runs.
import { serviceClient } from "./db.ts";
import { runIngest } from "./pipeline.ts";
import { createStore } from "./store.ts";
import { bangkokDate } from "./traffy.ts";

const window = { start: "2021-01-01", end: bangkokDate(new Date()) };
const started = Date.now();
const result = await runIngest(createStore(serviceClient()), window);
console.log(JSON.stringify({ window, ...result, seconds: Math.round((Date.now() - started) / 1000) }));
if (result.status === "failed") process.exitCode = 1;
