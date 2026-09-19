import { createContext, useContext } from "react";
import type { UseSettingsResult } from "@/hooks/useSettings";

export const SettingsContext = createContext<UseSettingsResult | null>(null);

export function useSettingsContext(): UseSettingsResult {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettingsContext must be used within a <SettingsProvider>");
  }
  return context;
}
