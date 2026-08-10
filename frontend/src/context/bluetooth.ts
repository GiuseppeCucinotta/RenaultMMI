import { createContext, useContext } from "react";
import type { UseBluetoothResult } from "@/hooks/useBluetooth";

export const BluetoothContext = createContext<UseBluetoothResult | null>(null);

export function useBluetoothContext(): UseBluetoothResult {
  const context = useContext(BluetoothContext);
  if (!context) {
    throw new Error("useBluetoothContext must be used within a <BluetoothProvider>");
  }
  return context;
}
