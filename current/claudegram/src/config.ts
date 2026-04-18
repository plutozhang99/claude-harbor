import { z } from "zod";

export const configSchema = z.object({
  port: z
    .string()
    .regex(/^\d+$/, "port must be a positive integer string")
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535))
    .default("8788"),
  db_path: z
    .string()
    .min(1)
    .refine((p) => !p.split(/[\/\\]/).includes(".."), {
      message: "db_path must not contain path traversal segments",
    })
    .default("./data/claudegram.db"),
  log_level: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return configSchema.parse({
    port: env["CLAUDEGRAM_PORT"],
    db_path: env["CLAUDEGRAM_DB_PATH"],
    log_level: env["CLAUDEGRAM_LOG_LEVEL"],
  });
}
