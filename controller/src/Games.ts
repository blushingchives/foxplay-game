export const GAMES = {
  minecraft: {
    fabric: {
      name: "fabric-mc",
      image: "fabric-mc",
      versions: ["0.1.0"] as string[],
    },
    paper: {
      name: "paper-mc",
      image: "paper-mc",
      versions: [] as string[],
    },
  },
};

type GameKey = keyof typeof GAMES;
type ServerEntry = (typeof GAMES)[GameKey][keyof (typeof GAMES)[GameKey]];

export function getServer(
  game: string,
  server: string,
): ServerEntry | undefined {
  const g = GAMES[game as GameKey];
  if (!g) return undefined;
  return g[server as keyof typeof g] as ServerEntry | undefined;
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
