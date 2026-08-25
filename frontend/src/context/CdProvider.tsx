import type { ReactNode } from "react";
import { CdContext } from "./cd";
import { useCd } from "@/hooks/useCd";

export function CdProvider({ children }: { children: ReactNode }) {
  const cd = useCd();
  return <CdContext.Provider value={cd}>{children}</CdContext.Provider>;
}
