import express from "express";
import bodyParser from "body-parser";
import { Pool, PoolClient } from "pg";
import https from "https";
import http from "http";
import pino from "pino";
import { LoggerClient } from "./LoggerClient";

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

function podman(method: string, path: string, body?: object): Promise<any> {
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
            resolve({ data: parsed, status: res.statusCode });
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

app.get("/minecraft/fabric/create", async (_, res) => {
  try {
    const createRes = await podman("POST", "/v5.0.0/libpod/containers/create", {
      image: "fabric-mc",
      name: "fabric-mc",
      portmappings: [
        { container_port: 25565, host_port: 25565, protocol: "tcp" },
        { container_port: 25565, host_port: 25565, protocol: "udp" },
        { container_port: 8080, host_port: 8080, protocol: "tcp" },
      ],
    });

    await podman(
      "POST",
      `/v5.0.0/libpod/containers/${createRes.data.Id}/start`,
    );

    return res.json({ id: createRes.data.Id });
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 404)
      return res.status(404).json({ error: "Image not found" });
    if (status === 409)
      return res.status(409).json({ error: "Container already exists" });
    logger.error(err);
    return res.status(500).json({ error: "Failed to create container" });
  }
});
