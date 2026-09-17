import { createContext, useContext } from "react";
import type { UseJukeboxResult } from "@/hooks/useJukebox";

export type JukeboxViewMode = "library" | "player";

export interface JukeboxContextValue extends UseJukeboxResult {
  viewMode: JukeboxViewMode;
  setViewMode: (mode: JukeboxViewMode) => void;
}

export const JukeboxContext = createContext<JukeboxContextValue | null>(null);

export function useJukeboxContext(): JukeboxContextValue {
  const context = useContext(JukeboxContext);
  if (!context) {
    throw new Error("useJukeboxContext must be used within a <JukeboxProvider>");
  }
  return context;
}
