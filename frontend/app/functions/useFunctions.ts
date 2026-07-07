"use client";
import { useEffect, useState } from "react";

const STORAGE_KEY = "functions";

// The list of uploaded function names, persisted in browser storage.
export function useFunctions() {
  const [functions, setFunctions] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setFunctions(JSON.parse(stored));
  }, []);

  function save(next: string[]) {
    setFunctions(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  return {
    functions,
    add(name: string) {
      if (!functions.includes(name)) save([...functions, name]);
    },
    remove(name: string) {
      save(functions.filter((f) => f !== name));
    },
  };
}
