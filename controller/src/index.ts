import express from "express";
import bodyParser from "body-parser";
import { Pool, PoolClient } from "pg";
import https from "https";
import http from "http";
import pino from "pino";
import { LoggerClient } from "./LoggerClient";
import { Podman } from "@podman/libpod";
import { getServer, isValid } from "./Games";
import { generateRandomString } from "./AlphanumericalGenerator";
type SpecGenerator = Parameters<
  Podman["api"]["libpod"]["containerCreateLibpod"]
>[0];
type ContainerCreateResponse = Awaited<
  ReturnType<Podman["api"]["libpod"]["containerCreateLibpod"]>
>["data"];

const agent = new https.Agent({ family: 4 }); // forces IPv4
const logger = LoggerClient();

// Environment Variables
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const init = async () => {
  app.listen(5000, async () => {
    logger.info(`Listening on port 5000`);
    logger.info(`Server ready to receive`);
  });
};
init();

app.get("/", (_, res) => {
  return res.send("HELLO");
});

const PODMAN_SOCKET = process.env.PODMAN_SOCKET ?? "/run/podman/podman.sock";

function podman<T = unknown>(
  method: string,
  path: string,
  body?: SpecGenerator,
): Promise<{ data: T; status: number }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "";
    const req = http.request(
      {
        socketPath: PODMAN_SOCKET,
        path,
        method: method.toUpperCase(),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk));
        res.on("end", () => {
          const parsed = raw ? JSON.parse(raw) : null;
          if (res.statusCode! >= 200 && res.statusCode! < 300) {
            resolve({ data: parsed, status: res.statusCode! });
          } else {
            const err: any = new Error(`HTTP ${res.statusCode}`);
            err.response = { status: res.statusCode, data: parsed };
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

app.get("/:game/:server/:version/create", async (req, res) => {
  const GAME = req.params.game;
  const SERVER = req.params.server;
  const VERSION = req.params.version;

  if (!isValid(GAME, SERVER, VERSION)) {
    return res.status(400).json({ error: "Invalid Params" });
  }
  const config = getServer(GAME, SERVER)!;

  try {
    const createRes = await podman<ContainerCreateResponse>(
      "POST",
      "/v5.0.0/libpod/containers/create",
      {
        image: `${config.image}:${VERSION}`,
        name: `${config.name}-${VERSION}-${generateRandomString(12)}`,
        portmappings: [
          { container_port: 25565, host_port: 25565, protocol: "tcp" },
          { container_port: 25565, host_port: 25565, protocol: "udp" },
          { container_port: 8080, host_port: 8080, protocol: "tcp" },
        ],
      },
    );

    await podman(
      "POST",
      `/v5.0.0/libpod/containers/${createRes.data.Id}/start`,
    );

    return res.json({ id: createRes.data.Id });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 404) return res.status(404).json({ error: err });
    if (status === 409) return res.status(409).json({ error: err });
    logger.error(err);
    return res.status(500).json({ error: err });
  }
});

app.get("/manage/:id/stop", async (req, res) => {
  const ID = req.params.id;
  if (ID == undefined) {
    return res.status(400).json({ error: "Invalid Params" });
  }

  try {
    await podman("POST", `/v5.0.0/libpod/containers/${ID}/stop?timeout=30`);

    return res.json({
      id: ID,
    });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 404) return res.status(404).json({ error: err });
    if (status === 409) return res.status(409).json({ error: err });
    logger.error(err);
    return res.status(500).json({ error: err });
  }
});

app.get("/manage/:id/start", async (req, res) => {
  const ID = req.params.id;
  if (ID == undefined) {
    return res.status(400).json({ error: "Invalid Params" });
  }

  try {
    await podman("POST", `/v5.0.0/libpod/containers/${ID}/start`);

    return res.json({
      id: ID,
    });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 404) return res.status(404).json({ error: err });
    if (status === 409) return res.status(409).json({ error: err });
    logger.error(err);
    return res.status(500).json({ error: err });
  }
});

app.get("/manage/:id/destroy", async (req, res) => {
  const ID = req.params.id;
  const FORCE = req.query.force == "true" ? true : false;

  if (ID == undefined) {
    return res.status(400).json({ error: "Invalid Params" });
  }

  try {
    await podman(
      "DELETE",
      `/v5.0.0/libpod/containers/${ID}${FORCE ? "?force=true&timeout=30" : ""}`,
    );

    return res.json({
      id: ID,
    });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 404) return res.status(404).json({ error: err });
    if (status === 409) return res.status(409).json({ error: err });
    logger.error(err);
    return res.status(500).json({ error: err });
  }
});
