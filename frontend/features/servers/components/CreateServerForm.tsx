"use client";
import Form from "next/form";
import { useState } from "react";
import { createPost } from "@/features/servers/actions";

const SERVER_TYPES: Record<string, string[]> = {
  minecraft: ["fabric"],
  satisfactory: ["base"],
};

export default function CreateServerForm() {
  const [game, setGame] = useState("minecraft");
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [input, setInput] = useState("");

  function addToWhitelist() {
    const name = input.trim();
    if (name && !whitelist.includes(name)) {
      setWhitelist([...whitelist, name]);
    }
    setInput("");
  }

  function removeFromWhitelist(name: string) {
    setWhitelist(whitelist.filter((n) => n !== name));
  }

  return (
    <Form action={createPost}>
      <label htmlFor="game">Game:</label>
      <select
        name="game"
        id="game"
        value={game}
        onChange={(e) => setGame(e.target.value)}
      >
        <option value="minecraft">Minecraft</option>
        <option value="satisfactory">Satisfactory</option>
      </select>

      {game === "minecraft" && (
        <>
          <label htmlFor="type">Type:</label>
          <select name="type" id="type">
            {SERVER_TYPES.minecraft.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </>
      )}

      {game === "satisfactory" && (
        <>
          <label htmlFor="type">Type:</label>
          <select name="type" id="type">
            {SERVER_TYPES.satisfactory.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </>
      )}

      <div>
        <label>Whitelist (include yourself):</label>
        <div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.preventDefault(), addToWhitelist())
            }
            placeholder="Player name"
          />
          <button type="button" onClick={addToWhitelist}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
          </button>
        </div>
        {whitelist.map((name) => (
          <div key={name}>
            {/* hidden input so the name is submitted with the form */}
            <input type="hidden" name="whitelist" value={name} />
            <span>{name}</span>
            <button type="button" onClick={() => removeFromWhitelist(name)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <button type="submit">Create Server</button>
    </Form>
  );
}
