import type { Db } from "./db.ts";
import type { Store } from "./pipeline.ts";

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export function createStore(db: Db): Store {
  return {
    async startRun({ start, end }) {
      const { data, error } = await db.from("ingest_runs").insert({ source: "traffy", status: "running", window_start: `${start}T00:00:00+07:00`, window_end: `${end}T23:59:59+07:00` }).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "ingest_runs insert returned no id");
      return data.id;
    },
    async upsert(rows) {
      // Area names are derived by the database trigger; input contains only PDPA-safe fields.
      const { error } = await db.from("flood_reports").upsert(rows, { onConflict: "source,source_id" });
      check(error);
    },
    async refresh() {
      const { error } = await db.rpc("refresh_score_reference");
      check(error);
    },
    async finishRun(id, result) {
      const { error } = await db.from("ingest_runs").update({ status: result.status, finished_at: new Date().toISOString(), rows_upserted: result.rowsUpserted, rows_rejected: result.rowsRejected, error: result.error?.slice(0, 2000) ?? null }).eq("id", id);
      check(error);
    },
  };
}
