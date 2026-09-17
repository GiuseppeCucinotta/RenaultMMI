import { useState, type ReactNode } from "react";
import { JukeboxContext, type JukeboxViewMode } from "./jukebox";
import { useJukebox } from "@/hooks/useJukebox";

export function JukeboxProvider({ children }: { children: ReactNode }) {
  const jukebox = useJukebox();
  const [viewMode, setViewMode] = useState<JukeboxViewMode>("library");
  return (
    <JukeboxContext.Provider value={{ ...jukebox, viewMode, setViewMode }}>
      {children}
    </JukeboxContext.Provider>
  );
}
