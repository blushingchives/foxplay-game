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

// Ids are type-prefixed UUIDs, e.g. fn-b8965196-1caf-4d21-b4f0-6bdc5f6a617e
const prefixedIdSchema = (prefix: string) =>
  z
    .string()
    .regex(
      new RegExp(
        `^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
      ),
      `invalid ${prefix} id`,
    );
export const functionIdSchema = prefixedIdSchema("fn");
export const deploymentIdSchema = prefixedIdSchema("art");
export const invocationIdSchema = prefixedIdSchema("log");
export const instanceIdSchema = prefixedIdSchema("srv");
export const sshKeyIdSchema = prefixedIdSchema("key");

export const sshPublicKeySchema = z
  .string()
  .regex(
    /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+) [A-Za-z0-9+/=]+/,
    "Paste a valid SSH public key (starts with ssh-ed25519, ssh-rsa, …)",
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
  id: functionIdSchema,
  name: functionNameSchema,
  user_id: z.string().nullable(), // NULL until Clerk auth lands
  created_at: z.string(),
  deleted_at: z.string().nullable(), // soft delete — history stays attributable
});
export type FunctionRow = z.infer<typeof functionRowSchema>;

// ---- ssh keys (saved public keys for server creation) ----
export const sshKeyRowSchema = z.object({
  id: sshKeyIdSchema,
  name: functionNameSchema,
  public_key: z.string(),
  user_id: z.string().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type SshKeyRow = z.infer<typeof sshKeyRowSchema>;

export const sshKeyCreateSchema = z.object({
  name: functionNameSchema,
  public_key: sshPublicKeySchema,
});
export type SshKeyCreate = z.infer<typeof sshKeyCreateSchema>;

// ---- instances (long-lived SSH-able VMs) ----
export const instanceStateSchema = z.enum([
  "creating",
  "running",
  "stopped",
  "error",
]);
export type InstanceState = z.infer<typeof instanceStateSchema>;

export const instanceRowSchema = z.object({
  id: instanceIdSchema,
  name: functionNameSchema,
  user_id: z.string().nullable(),
  state: z.string(),
  base_image: z.string(),
  vcpu: z.number(),
  mem_mib: z.number(),
  guest_ip: z.string().nullable(),
  ssh_host_port: z.number().nullable(),
  ssh_public_key: z.string().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type InstanceRow = z.infer<typeof instanceRowSchema>;

// create form: a display name, base image, and the SSH key to inject
export const instanceCreateSchema = z.object({
  name: functionNameSchema,
  base_image: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/, "invalid image")
    .default("alpine"),
  ssh_public_key: sshPublicKeySchema,
});
export type InstanceCreate = z.infer<typeof instanceCreateSchema>;

// ---- invocations ----
export const startTypeSchema = z.enum(["cold", "restored", "warm"]);
export type StartType = z.infer<typeof startTypeSchema>;

export const invocationSchema = z.object({
  id: invocationIdSchema,
  function_id: z.string(),
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

// shape returned per row by GET /api/functions/[id]/invocations
export const invocationRowSchema = invocationSchema.omit({
  id: true,
  function_id: true,
});
export type InvocationRow = z.infer<typeof invocationRowSchema>;

// ---- deployments ----
export const deploymentSchema = z.object({
  id: deploymentIdSchema,
  function_id: z.string(),
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

// shape returned as last_deployment by GET /api/functions/[id]
export const deploymentRowSchema = deploymentSchema.omit({
  id: true,
  function_id: true,
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
