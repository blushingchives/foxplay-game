import { z } from "zod";

// Row schemas for the Postgres tables as they appear serialized over JSON
// (timestamps arrive as ISO strings). The schema itself is owned by
// database/migrations; generated raw types live in database/typescript.
// Types are inferred from these schemas so validation and typing share one
// definition.

export const functionNameSchema = z
  .string()
  .regex(
    /^[a-z0-9-]{1,64}$/,
    "Use lowercase letters, digits, and hyphens only",
  );

// ---- users ----
export const userSchema = z.object({
  id: z.string(), // Clerk user id once auth lands
  email: z.string().nullable(),
  created_at: z.string(),
});
export type User = z.infer<typeof userSchema>;

// ---- functions (the registry) ----
export const functionRowSchema = z.object({
  id: z.uuid(),
  name: functionNameSchema,
  user_id: z.string().nullable(), // NULL until Clerk auth lands
  created_at: z.string(),
});
export type FunctionRow = z.infer<typeof functionRowSchema>;

// ---- invocations ----
export const startTypeSchema = z.enum(["cold", "restored", "warm"]);
export type StartType = z.infer<typeof startTypeSchema>;

export const invocationSchema = z.object({
  id: z.uuid(),
  function_name: z.string(),
  start_type: startTypeSchema,
  queue_wait_ms: z.number(),
  boot_ms: z.number(),
  invoke_ms: z.number(),
  status: z.number(),
  infra_error: z.boolean(),
  cpu_ms: z.number(),
  mem_peak_kb: z.number(),
  request_body: z.string(),
  created_at: z.string(),
});
export type Invocation = z.infer<typeof invocationSchema>;

// shape returned per row by GET /api/functions/[name]/invocations
export const invocationRowSchema = invocationSchema.omit({
  id: true,
  function_name: true,
});
export type InvocationRow = z.infer<typeof invocationRowSchema>;

// ---- deployments ----
export const deploymentSchema = z.object({
  id: z.uuid(),
  function_name: z.string(),
  image_size_bytes: z.number(),
  build_ms: z.number(),
  snapshot_enabled: z.boolean(),
  snapshot_ms: z.number(),
  snapshot_ok: z.boolean(),
  kernel_path: z.string(),
  kernel_size_bytes: z.number(),
  base_rootfs_path: z.string(),
  base_rootfs_size_bytes: z.number(),
  bootstrap_version: z.string(),
  created_at: z.string(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

// shape returned as last_deployment by GET /api/functions/[name]
export const deploymentRowSchema = deploymentSchema.omit({
  id: true,
  function_name: true,
});
export type DeploymentRow = z.infer<typeof deploymentRowSchema>;

// ---- forms ----
export const uploadFormSchema = z.object({
  name: functionNameSchema,
  file: z
    .instanceof(File, { message: "Choose a .tar.gz file to upload" })
    .refine(
      (f) => /\.(tar\.gz|tgz)$/i.test(f.name),
      "Please choose a .tar.gz or .tgz file",
    ),
  snapshot: z.boolean(),
});
export type UploadForm = z.infer<typeof uploadFormSchema>;
