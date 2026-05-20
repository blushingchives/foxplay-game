import express from "express";
import bodyParser from "body-parser";
import { Pool, PoolClient } from "pg";
import https from "https";
import http from "http";
import pino from "pino";
import { LoggerClient } from "./LoggerClient";
import fs from "fs";
import { getServer, isValid } from "./Games";
import { generateRandomString } from "./AlphanumericalGenerator";
import { backup, prune } from "./Backup";
import { ContainerCreateResponse, podman } from "./Podman";
import { findAvailablePorts } from "./Ports";

const agent = new https.Agent({ family: 4 }); // forces IPv4
const logger = LoggerClient();

// Environment Variables
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const init = async () => {
  const backupLoop = async () => {
    logger.info(`Backup job initiated`);
    while (true) {
      const now = new Date();
      const next = new Date(now);
      next.setSeconds(0, 0);
      next.setMinutes(0);
      next.setHours(now.getHours() < 12 ? 12 : 24);
      await new Promise((res) =>
        setTimeout(res, next.getTime() - now.getTime()),
      );
      try {
        await backup();
      } catch (err) {
        logger.error(err);
      }
    }
  };

  const pruneLoop = async () => {
    logger.info(`Prune job initiated`);
    while (true) {
      await new Promise((res) => setTimeout(res, 15 * 60 * 1000));
      try {
        await prune();
      } catch (err) {
        logger.error(err);
      }
    }
  };

  backupLoop();
  pruneLoop();

  app.listen(5000, async () => {
    logger.info(`Listening on port 5000`);
    logger.info(`Server ready to receive`);
  });
};
init();

app.get("/", (_, res) => {
  return res.send("HELLO");
});

app.get("/:game/:server/:version/create", async (req, res) => {
  const GAME = req.params.game;
  const SERVER = req.params.server;
  const VERSION = req.params.version;

  if (!isValid(GAME, SERVER, VERSION)) {
    return res.status(400).json({ error: "Invalid Params" });
  }

  const config = getServer(GAME, SERVER)!;
  const name =
    req.query.name == undefined
      ? `${config.name}-${VERSION}-${generateRandomString(12)}`
      : (req.query.name as string);
  const hostPath = `/foxplay-games/${name}`;
  await fs.promises.mkdir(hostPath, { recursive: true });

  const uniquePorts = new Set(
    config.port_config.map((port) => port.container_port),
  );
  const availablePorts = await findAvailablePorts(
    uniquePorts.size,
    20000,
    60000,
  );
  const portMapping: Map<number, number> = new Map();
  let index = 0;
  uniquePorts.forEach((port) => {
    portMapping.set(port, availablePorts[index]);
    index++;
  });

  const env: Record<string, string> = {};
  if (GAME === "satisfactory") {
    config.port_config.forEach((portConfig) => {
      const newPort = portMapping.get(portConfig.container_port)!;
      if (portConfig.container_port === 7777) {
        env["Port"] = newPort.toString();
      } else if (portConfig.container_port === 8888) {
        env["ReliablePort"] = newPort.toString();
      }
      portConfig.host_port = newPort;
      portConfig.container_port = newPort;
    });
  } else {
    config.port_config.forEach((portConfig) => {
      portConfig.host_port = portMapping.get(portConfig.container_port)!;
    });
  }
  try {
    const createRes = await podman<ContainerCreateResponse>(
      "POST",
      "/v5.0.0/libpod/containers/create",
      {
        image: `${config.image}:${VERSION}`,
        name: name,
        portmappings: config.port_config,
        mounts: [
          {
            type: "bind",
            source: hostPath,
            destination: config.backup_path,
            options: ["rbind", "rw"],
          } as any,
        ],
        env: env,
      },
    );

    await podman(
      "POST",
      `/v5.0.0/libpod/containers/${createRes.data.Id}/start`,
    );

    return res.json({ id: createRes.data.Id, port_config: config.port_config });
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

app.get("/manage/:id/backup", async (req, res) => {
  const ID = req.params.id;
  if (ID == undefined) {
    return res.status(400).json({ error: "Invalid Params" });
  }

  try {
    await backup(ID);
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
