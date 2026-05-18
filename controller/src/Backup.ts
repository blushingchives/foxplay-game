import { LoggerClient } from "./LoggerClient";
import fs from "fs";
import https from "https";
import { spawn } from "child_process";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
} from "@aws-sdk/client-s3";

const logger = LoggerClient();
require("dotenv").config();

const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: "auto",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID!,
    secretAccessKey: process.env.B2_APP_KEY!,
  },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({ family: 4 }),
  }),
});

const BUCKET = process.env.B2_BUCKET!;
const GAMES_DIR = "/foxplay-games";

export async function backup(container?: string) {
  const containers = container
    ? [container]
    : await fs.promises.readdir(GAMES_DIR);

  for (const container of containers) {
    const containerPath = `${GAMES_DIR}/${container}`;
    await fs.promises.access(containerPath).catch(() => {
      throw new Error(`Container directory not found: ${container}`);
    });

    const key = `${container}/${new Date().toISOString()}.tar.gz`;
    const tar = spawn("tar", ["-czf", "-", "-C", GAMES_DIR, container]);

    const chunks: Uint8Array[] = [];
    const exitCode = await new Promise<number>((resolve, reject) => {
      tar.on("error", reject);
      tar.stdout.on("data", (chunk) => chunks.push(chunk));
      tar.on("close", resolve);
    });

    if (exitCode !== 0)
      throw new Error(`tar failed with exit code ${exitCode}`);

    const body = Buffer.concat(chunks);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentLength: body.length,
      }),
    );

    logger.info(`Backed up ${container}`);
    await prune();
  }
}

export async function prune() {
  const containers = await fs.promises.readdir(GAMES_DIR);

  for (const container of containers) {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${container}/` }),
    );

    const toDelete = (list.Contents ?? [])
      .sort(
        (a: _Object, b: _Object) =>
          (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0),
      )
      .slice(10)
      .map((o: _Object) => ({ Key: o.Key! }));

    if (toDelete.length === 0) continue;

    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: toDelete },
      }),
    );

    logger.info(`Pruned ${toDelete.length} old backups for ${container}`);
  }
}
