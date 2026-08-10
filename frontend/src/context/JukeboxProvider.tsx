import type { ReactNode } from "react";
import { JukeboxContext } from "./jukebox";
import { useJukebox } from "@/hooks/useJukebox";

export function JukeboxProvider({ children }: { children: ReactNode }) {
  const jukebox = useJukebox();
  return <JukeboxContext.Provider value={jukebox}>{children}</JukeboxContext.Provider>;
}
