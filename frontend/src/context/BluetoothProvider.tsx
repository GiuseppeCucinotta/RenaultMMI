import type { ReactNode } from "react";
import { BluetoothContext } from "./bluetooth";
import { useBluetooth } from "@/hooks/useBluetooth";

export function BluetoothProvider({ children }: { children: ReactNode }) {
  const bluetooth = useBluetooth();
  return <BluetoothContext.Provider value={bluetooth}>{children}</BluetoothContext.Provider>;
}
