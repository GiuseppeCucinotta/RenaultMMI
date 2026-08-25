import { createContext, useContext } from "react";
import type { UseCdResult } from "@/hooks/useCd";

export const CdContext = createContext<UseCdResult | null>(null);

export function useCdContext(): UseCdResult {
  const context = useContext(CdContext);
  if (!context) {
    throw new Error("useCdContext must be used within a <CdProvider>");
  }
  return context;
}
