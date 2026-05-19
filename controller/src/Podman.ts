import { Podman } from "@podman/libpod";
import http from "http";

const PODMAN_SOCKET = process.env.PODMAN_SOCKET ?? "/run/podman/podman.sock";

type SpecGenerator = Parameters<
  Podman["api"]["libpod"]["containerCreateLibpod"]
>[0];
export type ContainerCreateResponse = Awaited<
  ReturnType<Podman["api"]["libpod"]["containerCreateLibpod"]>
>["data"];

export function podman<T = unknown>(
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
