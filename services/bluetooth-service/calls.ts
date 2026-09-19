import { HttpError } from "../shared/service-http.js";
import { logger } from "./logger.js";
import { IDLE_CALLS, type BluetoothCall, type BluetoothCalls } from "./types.js";

/**
 * The telephony actions the renderer is already allowed to send. They are
 * deliberately unimplemented: BlueZ alone cannot carry a call, so a backend
 * (oFono or equivalent) has to be wired in first.
 */
export type CallAction =
  | "answer"
  | "hangup"
  | "reject"
  | "dial"
  | "mute"
  | "unmute"
  | "hold"
  | "resume";

export interface CallActionRequest {
  action: CallAction;
  /** Required by `dial`, ignored otherwise. */
  number?: string;
  /** Target call for call-specific actions; defaults to the active call. */
  callId?: string;
}

/**
 * The seam where hands-free calling will land.
 *
 * Nothing here talks to hardware yet. When an HFP backend is added it only has
 * to implement {@link CallBackend} and be handed to {@link CallManager}: the
 * service state, the HTTP routes and the renderer contract already exist, so
 * the change stays additive.
 */
export interface CallBackend {
  readonly name: string;
  isAvailable(): boolean;
  getCalls(): BluetoothCall[];
  /** `null` when unknown. */
  getActiveCallId(): string | null;
  getRecentNumbers(): string[];
  run(request: CallActionRequest): Promise<void>;
}

export class CallManager {
  private readonly backend: CallBackend | null;

  constructor(backend: CallBackend | null = null) {
    this.backend = backend;
  }

  isSupported(): boolean {
    return this.backend?.isAvailable() ?? false;
  }

  getState(): BluetoothCalls {
    if (!this.isSupported()) return { ...IDLE_CALLS, calls: [] };
    const backend = this.backend as CallBackend;
    return {
      supported: true,
      activeCallId: backend.getActiveCallId(),
      calls: backend.getCalls(),
      recentNumbers: backend.getRecentNumbers(),
    };
  }

  /**
   * Rejects every call action while no backend is installed, so the renderer
   * gets an explicit "not supported" instead of a silent success.
   */
  async run(request: CallActionRequest): Promise<void> {
    if (!this.isSupported()) {
      logger.warn(`call action "${request.action}" ignored: no HFP backend installed`);
      throw new HttpError(501, "Phone calling is not available on this system yet");
    }
    await (this.backend as CallBackend).run(request);
  }
}
