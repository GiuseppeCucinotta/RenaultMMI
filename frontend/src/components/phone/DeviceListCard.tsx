import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { BluetoothDevice } from "@/types/bluetooth";
import { DeviceRow } from "./DeviceRow";

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
  const hasError = error != null && error.deviceId == null;

  return (
    <div className="flex h-full flex-col rounded-3xl border border-amber-500/20 bg-amber-950/40 px-7 py-6 backdrop-blur-sm">
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

      <div className="mt-5 min-h-0 flex-1 overflow-hidden">
        {devices.length === 0 ? (
          <EmptyState discovering={discovering} adapterPowered={adapterPowered} />
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

      {discovering ? (
        <p className="mt-3 flex shrink-0 items-center gap-2 text-xs text-amber-200/60">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("phone.devices.searching")}
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({
  discovering,
  adapterPowered,
}: {
  discovering: boolean;
  adapterPowered: boolean;
}) {
  const { t } = useI18n();
  const key = !adapterPowered
    ? "phone.devices.bluetoothOff"
    : discovering
      ? "phone.devices.searching"
      : "phone.devices.empty";
  return (
    <div className="flex h-full min-h-[8rem] items-center justify-center px-2">
      <p className="text-center text-sm text-amber-100/50">{t(key)}</p>
    </div>
  );
}
