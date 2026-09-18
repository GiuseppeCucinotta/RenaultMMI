import { useEffect } from "react";
import type { BluetoothScanAction } from "@/types/bluetooth";

/**
 * Runs the device scan while the Phone view needs it.
 *
 * The service also stops its own inquiry after 60 s, so this is not the only
 * safety net; it exists so the radio is not left scanning once the user leaves
 * the screen. The scan belongs to this screen, so unmount always stops it.
 */
export function useScanWindow(
  enabled: boolean,
  scan: (action: BluetoothScanAction) => Promise<void>,
): void {
  useEffect(() => {
    if (!enabled) return;
    void scan("start");
    return () => {
      void scan("stop");
    };
  }, [enabled, scan]);
}
