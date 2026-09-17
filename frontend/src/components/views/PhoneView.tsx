import { useEffect, useMemo, useRef, useState } from "react";
import { Bluetooth, RefreshCw } from "lucide-react";
import { useBluetoothContext } from "@/context/bluetooth";
import { useI18n } from "@/i18n";
import { SelectableCard } from "@/components/phone/SelectableCard";
import { ConnectedPhoneScreen } from "@/components/phone/ConnectedPhoneScreen";
import { DeviceListCard } from "@/components/phone/DeviceListCard";
import { PairingModal } from "@/components/phone/PairingModal";
import { BluetoothArtwork } from "@/components/phone/BluetoothArtwork";
import { useScanWindow } from "@/components/phone/useScanWindow";
import type { BluetoothDevice } from "@/types/bluetooth";

/**
 * Phone source view.
 *
 * Two states, one switch: with no phone connected it shows the connect screen
 * from the design (status column + "List of devices"), and with a phone
 * connected it shows the connection summary plus the placeholder cards that
 * future call features will fill in. When several phones are connected the one
 * flagged `primary` wins.
 */
export function PhoneView() {
  const {
    state,
    scan,
    phoneAction,
    pairingAction,
    busyDeviceId,
    actionError,
    clearActionError,
    pairing,
  } = useBluetoothContext();

  const primary = useMemo<BluetoothDevice | null>(() => {
    const connected = state.devices.filter((device) => device.connected);
    return connected.find((device) => device.primary) ?? connected[0] ?? null;
  }, [state.devices]);

  useScanWindow(primary == null, scan);

  return (
    <div className="relative flex h-full w-full flex-col pr-2 pt-1">
      {primary ? (
        <ConnectedPhoneScreen
          device={primary}
          busy={busyDeviceId === primary.id}
          onDisconnect={() => void phoneAction("disconnect", primary.id)}
        />
      ) : (
        <ConnectScreen
          devices={state.devices}
          discovering={state.discovering}
          adapterPowered={state.adapter.powered}
          available={state.available}
          busyDeviceId={busyDeviceId}
          actionError={actionError}
          onRefresh={() => void scan("refresh")}
          onRescan={() => void scan("start")}
          onConnect={(device) => void phoneAction("connect", device.id)}
          onForget={(device) => void phoneAction("forget", device.id)}
          onDismissError={clearActionError}
        />
      )}

      {/*
        The modal owns the whole pairing interaction: it is shown while the
        prompt is up *and* while the phone finishes connecting, because it swaps
        its buttons for a progress state in between. Unmounting it the moment
        the prompt was answered is what made the buttons look dead.
      */}
      {pairing.stage === "awaiting-confirmation" || pairing.stage === "pairing" ? (
        <PairingModal
          pairing={pairing}
          onAction={(action, payload) => void pairingAction(action, payload)}
        />
      ) : null}

      <DiscoveredHint count={state.devices.length} hidden={primary != null} />
    </div>
  );
}

interface ConnectScreenProps {
  devices: BluetoothDevice[];
  discovering: boolean;
  adapterPowered: boolean;
  available: boolean;
  busyDeviceId: string | null;
  actionError: { deviceId: string | null; message: string } | null;
  onRefresh: () => void;
  onRescan: () => void;
  onConnect: (device: BluetoothDevice) => void;
  onForget: (device: BluetoothDevice) => void;
  onDismissError: () => void;
}

/** The "Phone not connected" layout from the reference design. */
function ConnectScreen({
  devices,
  discovering,
  adapterPowered,
  available,
  busyDeviceId,
  actionError,
  onRefresh,
  onRescan,
  onConnect,
  onForget,
  onDismissError,
}: ConnectScreenProps) {
  const { t } = useI18n();

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8">
      <div className="flex min-h-0 items-center gap-6">
        <BluetoothArtwork
          className="-my-6 h-full max-h-[24rem] w-auto shrink-0"
          alt={t("phone.imageAlt")}
        />

        <div className="min-w-0 flex-1">
          <h1 className="text-4xl font-medium leading-tight tracking-wide text-amber-50">
            {t("phone.notConnected.title")}
          </h1>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-amber-100/75">
            {t("phone.notConnected.subtitle")}
          </p>

          {!available ? (
            <p className="mt-6 text-sm text-amber-200/60">{t("phone.notConnected.serviceDown")}</p>
          ) : null}

          <div className="mt-7 flex items-center gap-3">
            <SelectableCard
              onSelect={onRescan}
              ariaLabel={t("phone.notConnected.search")}
              className="w-auto px-6 py-3"
              selectedClassName="border-amber-400/70 bg-amber-500/15"
            >
              <span className="flex items-center gap-3 text-base text-amber-100">
                <Bluetooth className="h-5 w-5" strokeWidth={1.8} />
                {t("phone.notConnected.search")}
                {discovering ? <RefreshCw className="h-4 w-4 animate-spin text-amber-300" /> : null}
              </span>
            </SelectableCard>
          </div>
        </div>
      </div>

      <DeviceListCard
        devices={devices}
        discovering={discovering}
        adapterPowered={adapterPowered}
        busyDeviceId={busyDeviceId}
        error={actionError}
        onRefresh={onRefresh}
        onConnect={onConnect}
        onForget={onForget}
        onDismissError={onDismissError}
      />
    </div>
  );
}

/**
 * Transient hint that the phone list changed while the viewer was idle — a
 * handy signal on real hardware while the device filter is being tuned.
 */
function DiscoveredHint({ count, hidden }: { count: number; hidden: boolean }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const previous = useRef(count);

  useEffect(() => {
    if (hidden || count === previous.current) {
      previous.current = count;
      return;
    }
    previous.current = count;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 2600);
    return () => window.clearTimeout(timer);
  }, [count, hidden]);

  if (!visible || count === 0) return null;
  return (
    <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-amber-500/25 bg-amber-950/80 px-4 py-1.5 text-xs text-amber-100/70">
      {t("phone.devices.found", { count })}
    </p>
  );
}
