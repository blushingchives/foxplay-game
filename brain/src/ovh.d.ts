declare module "@ovhcloud/node-ovh" {
  interface OvhOptions {
    appKey: string;
    appSecret: string;
    consumerKey: string;
    endpoint: string;
  }

  class OvhEngine {
    constructor(options: OvhOptions);
    requestPromised(method: string, path: string, body?: object): Promise<any>;
  }

  export default OvhEngine;
}
