import type { ReactNode } from "react";
import { SettingsContext } from "./settings";
import { useSettings } from "@/hooks/useSettings";

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}
