import { createLogger } from "../shared/logger.js";

/** The one logger for this service; the scope shows up in every line. */
export const logger = createLogger("trip");
