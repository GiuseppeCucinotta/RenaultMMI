import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { BluetoothDevice } from "@/types/bluetooth";
import { DeviceRow } from "./DeviceRow";
import { useDragToScroll } from "./useDragToScroll";

interface DeviceListCardProps {
  devices: BluetoothDevice[];
  discovering: boolean;
  adapterPowered: boolean;
  busyDeviceId: string | null;
  error: { deviceId: string | null; message: string } | null;
  onRefresh: () => void;
  onConnect: (device: BluetoothDevice) => void;
  onForget: (device: BluetoothDevice) => void;
  onDismissError: () => void;
}

/**
 * "List of devices" card from the design: paired phones first, then nearby
 * ones found by the scan, with the refresh control in the header.
 */
export function DeviceListCard({
  devices,
  discovering,
  adapterPowered,
  busyDeviceId,
  error,
  onRefresh,
  onConnect,
  onForget,
  onDismissError,
}: DeviceListCardProps) {
  const { t } = useI18n();
  const listRef = useDragToScroll<HTMLDivElement>();
  const hasError = error != null && error.deviceId == null;

  return (
    <div className="flex h-full max-h-[21rem] min-h-0 w-full flex-col self-center overflow-hidden rounded-3xl border border-amber-500/20 bg-linear-to-br from-[#F59E0B]/10 to-[#09090B]/20 px-7 py-6 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium text-2xl tracking-wide text-amber-50">
          {t("phone.devices.title")}
        </h2>
        <button
          type="button"
          onClick={() => {
            onDismissError();
            onRefresh();
          }}
          aria-label={t("phone.devices.refresh")}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full outline-none transition-colors",
            "text-amber-200 hover:bg-amber-500/15 hover:text-amber-100",
            "focus-visible:ring-2 focus-visible:ring-amber-500/80",
          )}
        >
          <RefreshCw
            className={cn("h-7 w-7", (discovering || busyDeviceId != null) && "animate-spin")}
            strokeWidth={1.8}
          />
        </button>
      </div>

      {hasError ? (
        <p className="mt-4 text-sm text-red-300/90">{error?.message}</p>
      ) : null}

      <div
        ref={listRef}
        className="mt-5 min-h-0 flex-1 cursor-grab touch-pan-y overflow-y-auto active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {devices.length === 0 ? (
          <EmptyState adapterPowered={adapterPowered} />
        ) : (
          <ul className="flex flex-col">
            {devices.map((device, index) => (
              <li key={device.id}>
                <DeviceRow
                  device={device}
                  busy={busyDeviceId === device.id}
                  error={error?.deviceId === device.id ? error?.message ?? null : null}
                  divider={index > 0}
                  onConnect={() => onConnect(device)}
                  onForget={() => onForget(device)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyState({ adapterPowered }: { adapterPowered: boolean }) {
  const { t } = useI18n();
  const key = !adapterPowered ? "phone.devices.bluetoothOff" : "phone.devices.empty";
  return (
    <div className="flex h-full min-h-[8rem] items-center justify-center px-2">
      <p className="text-center text-sm text-amber-100/50">{t(key)}</p>
    </div>
  );
}
