import fs from "fs";

async function getUsedPorts(): Promise<Set<number>> {
  const files = [
    "/proc/net/tcp",
    "/proc/net/tcp6",
    "/proc/net/udp",
    "/proc/net/udp6",
  ];
  const ports = new Set<number>();

  for (const file of files) {
    const content = await fs.promises.readFile(file, "utf-8");
    for (const line of content.split("\n").slice(1)) {
      const localAddr = line.trim().split(/\s+/)[1];
      if (!localAddr) continue;
      ports.add(parseInt(localAddr.split(":")[1], 16));
    }
  }

  return ports;
}

export async function findAvailablePorts(
  count: number,
  start: number,
  end: number,
): Promise<number[]> {
  const used = await getUsedPorts();
  const ports: number[] = [];
  for (let port = start; port <= end && ports.length < count; port++) {
    if (!used.has(port)) {
      ports.push(port);
      used.add(port);
    }
  }
  return ports;
}
