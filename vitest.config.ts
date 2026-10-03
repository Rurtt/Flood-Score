import { defineConfig } from "vitest/config";

// Integration tests use the local service-role key when the optional file exists.
try {
  process.loadEnvFile(".env.ingest");
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "ingest/**/*.test.ts"],
  },
});
