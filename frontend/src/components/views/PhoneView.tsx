import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useBluetoothContext } from "@/context/bluetooth";
import { useI18n } from "@/i18n";
import { ConnectedPhoneScreen } from "@/components/views/phone/ConnectedPhoneScreen";
import { DeviceListCard } from "@/components/views/phone/DeviceListCard";
import { PairingModal } from "@/components/views/phone/PairingModal";
import { BluetoothArtwork } from "@/components/views/phone/BluetoothArtwork";
import { useScanWindow } from "@/components/views/phone/useScanWindow";
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
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
      className="relative flex h-full w-full flex-col pr-2 pt-1"
    >
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
          onRefresh={() => void scan("start")}
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
    </motion.div>
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
  onConnect,
  onForget,
  onDismissError,
}: ConnectScreenProps) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] grid-rows-[minmax(0,1fr)] gap-8">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="flex h-full min-h-0 flex-col justify-center"
      >
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
      </motion.div>

      <div className="flex min-h-0 items-center gap-6">
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 280, damping: 24, delay: reduceMotion ? 0 : 0.12 }}
          className="min-w-0 flex-1"
        >
          <h1 className="text-4xl font-medium leading-tight tracking-wide text-amber-50">
            {t("phone.notConnected.title")}
          </h1>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-amber-100/75">
            {t("phone.notConnected.subtitle")}
          </p>

          {!available ? (
            <p className="mt-6 text-sm text-amber-200/60">{t("phone.notConnected.serviceDown")}</p>
          ) : null}
        </motion.div>

        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: reduceMotion ? 0 : 0.5,
            ease: "easeOut",
            delay: reduceMotion ? 0 : 0.24,
          }}
          className="h-full min-h-0 shrink-0"
        >
          <BluetoothArtwork
            className="-my-6 h-full max-h-[24rem] w-auto shrink-0 -scale-x-100"
            alt={t("phone.imageAlt")}
          />
        </motion.div>
      </div>
    </div>
  );
}
