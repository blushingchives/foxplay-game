import express from "express";
import bodyParser from "body-parser";
import https from "https";
import OvhEngine from "@ovhcloud/node-ovh";
import { LoggerClient } from "./LoggerClient";

const agent = new https.Agent({ family: 4 }); // forces IPv4
const logger = LoggerClient();

// Environment Variables
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const ovh = new OvhEngine({
  appKey: "0135d6f397bdbfc7",
  appSecret: "1dea6a8164efb1fc0fa9146078685c01",
  consumerKey: "28e6369de8319af50e4ce6be41237909",
  endpoint: "ovh-ca",
});

const SERVICE_NAME = process.env.OVH_SERVICE_NAME!;

const init = async () => {
  // const instance = await ovh.requestPromised(
  //   "POST",
  //   `/cloud/project/${SERVICE_NAME}/instance`,
  //   {
  //     flavorId: process.env.OVH_FLAVOR_ID!,
  //     imageId: process.env.OVH_IMAGE_ID!,
  //     name: "game-server-test",
  //     region: process.env.OVH_REGION!,
  //     sshKeyId: process.env.OVH_SSH_KEY_ID!,
  //   },
  // );
  // logger.info(instance);
  try {
    const info = await ovh.requestPromised(
      "GET",
      `/price/vps/2018v1/cloudram/model/r3-32-flex`,
      {},
    );
    console.log(info);
    logger.info(info);
  } catch (err) {
    logger.error(err);
  }
};
init();
