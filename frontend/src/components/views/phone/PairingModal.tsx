import { useState } from "react";
import { Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n";
import type { BluetoothPairing, BluetoothPairingAction } from "@/types/bluetooth";

interface PairingModalProps {
  pairing: BluetoothPairing;
  onAction: (action: BluetoothPairingAction, payload?: { value?: string }) => void;
}

/**
 * The prompt BlueZ blocks on while pairing. Which variant is shown comes from
 * `pairing.method`, so adding a method is a data change, not a UI rewrite.
 *
 * Answering a prompt takes a round-trip (and, on success, the phone still has
 * to bring its profiles up), so the buttons are replaced by a progress state
 * the instant one is pressed. Without it the controls sit there looking dead
 * and can be pressed twice — the service answers only the first one.
 */
export function PairingModal({ pairing, onAction }: PairingModalProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState<"confirm" | "reject" | "submit" | null>(null);
  const name = pairing.deviceName ?? t("phone.pairing.unknownDevice");

  const digits = pairing.passkey ?? "";
  const canSubmit = typed.replace(/\D/g, "").length >= 4;

  const act = (action: BluetoothPairingAction) => {
    if (pending) return;
    setPending(action === "reject" ? "reject" : action === "submit" ? "submit" : "confirm");
    onAction(action, action === "submit" ? { value: typed } : undefined);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("phone.pairing.title")}
        className="w-[30rem] max-w-[88%] rounded-3xl border border-amber-500/30 bg-amber-950/90 px-8 py-6 shadow-[0_0_48px_rgba(245,158,11,0.18)]"
      >
        <div className="flex items-center gap-3">
          {pairing.method === "passkey-entry" ? (
            <ShieldCheck className="h-6 w-6 text-amber-400" strokeWidth={1.8} />
          ) : (
            <TriangleAlert className="h-6 w-6 text-amber-400" strokeWidth={1.8} />
          )}
          <h2 className="text-xl font-medium tracking-wide text-amber-50">
            {t("phone.pairing.title")}
          </h2>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-amber-100/85">
          {pairing.method === "passkey-entry"
            ? t("phone.pairing.enterCode", { name })
            : t("phone.pairing.compareCode", { name })}
        </p>

        {pairing.method === "passkey-entry" ? (
          <input
            autoFocus
            value={typed}
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setTyped(event.target.value.replace(/\D/g, ""))}
            placeholder={t("phone.pairing.codePlaceholder")}
            aria-label={t("phone.pairing.codeLabel")}
            className="mt-4 w-full rounded-2xl border border-amber-500/30 bg-amber-950/70 px-5 py-3 text-center font-mono text-3xl tracking-[0.4em] text-amber-100 outline-none focus:border-amber-400/70"
          />
        ) : digits ? (
          <p className="mt-4 text-center font-mono text-4xl tracking-[0.35em] text-amber-300">
            {digits}
          </p>
        ) : null}

        <div className="mt-6 flex min-h-[2.75rem] items-center justify-end gap-3">
          {pending ? (
            <span
              role="status"
              className="flex items-center gap-3 text-base text-amber-100/80"
            >
              <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
              {pending === "reject"
                ? t("phone.pairing.rejecting")
                : t("phone.pairing.finishing", { name })}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => act("cancel")}
                className="rounded-full px-6 py-2.5 text-sm text-amber-100/70 outline-none transition-colors hover:bg-amber-500/10 hover:text-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500/70"
              >
                {t("phone.pairing.cancel")}
              </button>
              {pairing.method === "passkey-entry" ? (
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => act("submit")}
                  className="rounded-full bg-amber-500 px-7 py-2.5 text-sm font-medium text-amber-950 outline-none transition-colors hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("phone.pairing.confirm")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => act("reject")}
                    className="rounded-full border border-amber-500/30 px-7 py-2.5 text-sm text-amber-100/80 outline-none transition-colors hover:bg-amber-500/10 hover:text-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500/70"
                  >
                    {t("phone.pairing.reject")}
                  </button>
                  <button
                    type="button"
                    onClick={() => act("confirm")}
                    className="rounded-full bg-amber-500 px-7 py-2.5 text-sm font-medium text-amber-950 outline-none transition-colors hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    {t("phone.pairing.confirm")}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
