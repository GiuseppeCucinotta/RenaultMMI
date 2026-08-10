import { createContext, useContext } from "react";
import type { UseJukeboxResult } from "@/hooks/useJukebox";

export const JukeboxContext = createContext<UseJukeboxResult | null>(null);

export function useJukeboxContext(): UseJukeboxResult {
  const context = useContext(JukeboxContext);
  if (!context) {
    throw new Error("useJukeboxContext must be used within a <JukeboxProvider>");
  }
  return context;
}
