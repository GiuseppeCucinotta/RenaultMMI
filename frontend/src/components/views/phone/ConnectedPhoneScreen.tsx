import { Battery, BatteryLow, BatteryMedium, Bluetooth, Signal, SignalHigh, SignalLow } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useI18n } from "@/i18n";
import type { BluetoothDevice } from "@/types/bluetooth";
import { cn } from "@/lib/utils";
import { SelectableCard } from "./SelectableCard";

interface ConnectedPhoneScreenProps {
  device: BluetoothDevice;
  onDisconnect: () => void;
  busy: boolean;
}

/**
 * The screen shown while a phone is connected: a connection summary plus the
 * placeholders for everything that will grow onto this page.
 */
export function ConnectedPhoneScreen({ device, onDisconnect, busy }: ConnectedPhoneScreenProps) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();

  const placeholders: { key: string; title: string }[] = [
    { key: "contacts", title: t("phone.connected.contacts") },
    { key: "messages", title: t("phone.connected.messages") },
    { key: "media", title: t("phone.connected.media") },
    { key: "recent", title: t("phone.connected.recentCalls") },
    { key: "settings", title: t("phone.connected.deviceSettings") },
    { key: "calls", title: t("phone.connected.calls") },
  ];

  return (
    <div className="flex h-full w-full flex-col gap-5 pr-2 pt-1">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
      >
        <ConnectionSummary
          device={device}
          busy={busy}
          onDisconnect={onDisconnect}
        />
      </motion.div>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
        {placeholders.map((card, index) => (
          <motion.div
            key={card.key}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: "spring",
              stiffness: 280,
              damping: 24,
              delay: reduceMotion ? 0 : 0.12 + index * 0.06,
            }}
            className="min-h-0"
          >
            <SelectableCard
              disabled
              ariaLabel={card.title}
              className="flex h-full flex-col justify-between px-5 py-4"
            >
              <span className="text-sm font-medium tracking-wide text-amber-100/70">
                {card.title}
              </span>
              <span className="text-xs text-amber-100/35">{t("phone.connected.comingSoon")}</span>
            </SelectableCard>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ConnectionSummary({
  device,
  busy,
  onDisconnect,
}: {
  device: BluetoothDevice;
  busy: boolean;
  onDisconnect: () => void;
}) {
  const { t } = useI18n();

  const capabilities = [
    device.capabilities.audio ? t("phone.connected.capability.audio") : null,
    device.capabilities.handsFree ? t("phone.connected.capability.calls") : null,
    device.capabilities.remoteControl ? t("phone.connected.capability.remote") : null,
  ].filter((label): label is string => label != null);

  return (
    <div className="flex items-center gap-6 rounded-3xl border border-amber-500/25 bg-amber-950/40 px-7 py-5 backdrop-blur-sm">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-amber-400/40 bg-amber-500/15 text-amber-300">
        <Bluetooth className="h-8 w-8" strokeWidth={1.6} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-[0.2em] text-amber-200/60">
          {t("phone.connected.title")}
        </p>
        <p className="truncate text-2xl font-medium text-amber-50">{device.name}</p>
        <p className="mt-0.5 truncate text-sm text-amber-100/50">{device.address}</p>
      </div>

      <div className="flex shrink-0 items-center gap-5 text-amber-100/60">
        {device.batteryPercent != null ? (
          <span className="flex items-center gap-2 text-sm">
            <BatteryGlyph percent={device.batteryPercent} />
            {device.batteryPercent}%
          </span>
        ) : null}
        {device.rssi != null ? (
          <span className="flex items-center gap-2 text-sm">
            <SignalGlyph rssi={device.rssi} />
            {device.rssi} dBm
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/15 px-4 py-1.5 text-sm text-amber-200">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          {t("phone.devices.connected")}
        </span>
        {capabilities.length > 0 ? (
          <span className="text-xs text-amber-100/40">{capabilities.join(" · ")}</span>
        ) : null}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onDisconnect}
        className={cn(
          "shrink-0 rounded-full border border-amber-500/30 px-6 py-3 text-base outline-none transition-colors",
          "text-amber-100/80 hover:bg-red-500/15 hover:text-red-200",
          "focus-visible:ring-2 focus-visible:ring-amber-500/70 disabled:opacity-40",
        )}
      >
        {t("phone.connected.disconnect")}
      </button>
    </div>
  );
}

function BatteryGlyph({ percent }: { percent: number }) {
  if (percent <= 20) return <BatteryLow className="h-5 w-5" />;
  if (percent <= 60) return <BatteryMedium className="h-5 w-5" />;
  return <Battery className="h-5 w-5" />;
}

function SignalGlyph({ rssi }: { rssi: number }) {
  if (rssi <= -75) return <SignalLow className="h-5 w-5" />;
  if (rssi <= -60) return <Signal className="h-5 w-5" />;
  return <SignalHigh className="h-5 w-5" />;
}
