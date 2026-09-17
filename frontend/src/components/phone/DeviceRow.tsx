import { Battery, BatteryLow, BatteryMedium, Link2, Loader2, Smartphone, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { BluetoothDevice } from "@/types/bluetooth";

interface DeviceRowProps {
  device: BluetoothDevice;
  busy: boolean;
  error: string | null;
  divider: boolean;
  onConnect: () => void;
  onForget: () => void;
}

function BatteryIcon({ percent }: { percent: number }) {
  if (percent <= 20) return <BatteryLow className="h-4 w-4" />;
  if (percent <= 60) return <BatteryMedium className="h-4 w-4" />;
  return <Battery className="h-4 w-4" />;
}

/**
 * One phone in the list. The whole row is the action (connect / pair), with
 * "forget" separated so a mis-tap cannot unpair a phone.
 */
export function DeviceRow({ device, busy, error, divider, onConnect, onForget }: DeviceRowProps) {
  const { t } = useI18n();

  const status = device.connected
    ? t("phone.devices.connected")
    : device.paired
      ? t("phone.devices.paired")
      : t("phone.devices.available");

  return (
    <div className={cn("py-1", divider && "border-t border-amber-500/15")}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          aria-label={t("phone.devices.connectTo", { name: device.name })}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3 text-left outline-none transition-colors",
            "hover:bg-amber-500/10 focus-visible:bg-amber-500/10",
            "focus-visible:ring-2 focus-visible:ring-amber-500/70 disabled:opacity-60",
          )}
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
              device.connected
                ? "border-amber-400/60 bg-amber-500/20 text-amber-200"
                : "border-amber-500/20 bg-amber-950/60 text-amber-300/70",
            )}
          >
            <Smartphone className="h-5 w-5" strokeWidth={1.8} />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-base text-amber-50">{device.name}</span>
            <span className="mt-0.5 flex items-center gap-2 text-xs text-amber-100/50">
              <span className="truncate">{device.address}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{status}</span>
            </span>
          </span>

          {device.batteryPercent != null ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-amber-100/60">
              <BatteryIcon percent={device.batteryPercent} />
              {device.batteryPercent}%
            </span>
          ) : null}

          {busy ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-300" />
          ) : device.connected ? (
            <Link2 className="h-5 w-5 shrink-0 text-amber-400" />
          ) : null}
        </button>

        {device.paired ? (
          <button
            type="button"
            onClick={onForget}
            disabled={busy}
            aria-label={t("phone.devices.forgetDevice", { name: device.name })}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full outline-none transition-colors",
              "text-amber-100/35 hover:bg-red-500/15 hover:text-red-300",
              "focus-visible:ring-2 focus-visible:ring-red-400/70 disabled:opacity-40",
            )}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
      </div>

      {error ? <p className="px-2 pb-2 text-xs text-red-300/90">{error}</p> : null}
    </div>
  );
}
