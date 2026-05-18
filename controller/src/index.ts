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
      try {
        await prune();
      } catch (err) {
        logger.error(err);
      }
      await new Promise((res) => setTimeout(res, 15 * 60 * 1000));
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
  const name = `${config.name}-${VERSION}-${generateRandomString(12)}`;
  const hostPath = `/foxplay-games/${name}`;
  await fs.promises.mkdir(hostPath, { recursive: true });
  try {
    const createRes = await podman<ContainerCreateResponse>(
      "POST",
      "/v5.0.0/libpod/containers/create",
      {
        image: `${config.image}:${VERSION}`,
        name: name,
        portmappings: config.port_config.map((ports) => {
          return {
            container_port: ports.container_port,
            host_port: ports.host_port,
            protocol: ports.protocol,
          };
        }),
        mounts: [
          {
            type: "bind",
            source: hostPath,
            destination: `/minecraft/world`,
            options: ["rbind", "rw"],
          } as any,
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
