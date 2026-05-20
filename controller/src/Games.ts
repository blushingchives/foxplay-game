export const GAMES = {
  "satisfactory/base": {
    name: "satisfactory",
    image: "satisfactory",
    backup_path: "/minecraft/world",
    versions: ["0.1.0"] as string[],
    port_config: [
      { host_port: 0, container_port: 7777, protocol: "tcp" },
      { host_port: 0, container_port: 7777, protocol: "udp" },
      { host_port: 0, container_port: 8888, protocol: "tcp" },
    ],
  },
  "minecraft/fabric": {
    name: "fabric-mc",
    image: "fabricmc",
    backup_path: "/minecraft/world",
    versions: ["0.1.0"] as string[],
    port_config: [
      { host_port: 0, container_port: 25565, protocol: "tcp" },
      { host_port: 0, container_port: 25565, protocol: "udp" },
      { host_port: 0, container_port: 8080, protocol: "tcp" },
    ],
  },
};

type ServerEntry = (typeof GAMES)[keyof typeof GAMES];

export function getServer(
  game: string,
  server: string,
): ServerEntry | undefined {
  return structuredClone(GAMES[`${game}/${server}` as keyof typeof GAMES]);
}

export function isValid(
  game: string,
  server: string,
  version: string,
): boolean {
  const s = getServer(game, server);
  if (!s) return false;
  return s.versions.includes(version);
}
