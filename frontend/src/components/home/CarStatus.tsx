import { CircleSlash2, Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import carWireframe from "@/assets/modus_wireframe.png";
import FuelIcon from "@/assets/icons/homeIcons/fuelConsumptionIcon.svg"

export interface CarStatusProps {
  fuelLevel?: number;
  consumption?: number;
  vehicleStatus?: string;
}

const defaultFuel = 72;
const defaultConsumption = 4.1;

export function CarStatus({
  fuelLevel = defaultFuel,
  consumption = defaultConsumption,
  vehicleStatus,
}: CarStatusProps) {
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();
  const status = vehicleStatus ?? t("car.statusOk");

  const statEntrance = (delay: number) => ({
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 },
    animate: { opacity: 1, x: 0 },
    transition: { type: "spring" as const, stiffness: 280, damping: 24, delay },
  });

  return (
    <div className="flex-[0_0_30%] h-full min-w-75">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="h-full"
      >
        <Card className="h-full border border-white/10 rounded-[20px] bg-[#0a0a0a]/10 backdrop-blur-md overflow-hidden">
          <CardContent className="flex h-full p-6 gap-6">
            <div className="flex flex-col justify-between h-full w-1/2">
              {/* Stats */}
              <div className="flex flex-col gap-4">
                {/* Fuel */}
                <motion.div {...statEntrance(0.1)} className="flex items-center gap-3">
                  <img
                    src={FuelIcon}
                    className="w-9 h-9 text-warm-300 shrink-0"
                  />
                  <span className="text-2xl font-extrabold text-warm-300 tracking-tight">
                    {fuelLevel}%
                  </span>
                </motion.div>

                {/* Consumption */}
                <motion.div {...statEntrance(0.18)} className="flex items-center gap-3">
                  <CircleSlash2
                    className="w-9 h-9 text-warm-300 shrink-0"
                    strokeWidth={2}
                  />
                  <span className="text-2xl font-extrabold text-warm-300 -tight">
                    {consumption.toFixed(1)} l/100km
                  </span>
                </motion.div>

                {/* Status */}
                <motion.div {...statEntrance(0.26)} className="flex items-center gap-3">
                  <Check
                    className="w-9 h-9 text-warm-300 shrink-0"
                    strokeWidth={2}
                  />
                  <span className="text-2xl font-extrabold text-warm-300 tracking-tight">
                    {status}
                  </span>
                </motion.div>
              </div>

              {/* Car title at bottom-left — much bigger */}
              <motion.h2
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 280, damping: 24, delay: 0.32 }}
                className="text-5xl font-extrabold text-warm-300 tracking-wide"
              >
                {t("car.title")}
              </motion.h2>
            </div>

            {/* RIGHT: Wireframe image — large, spills outside card to the right */}
            <motion.div
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 56 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 180, damping: 26, delay: 0.22 }}
              className="flex-1 relative overflow-visible"
            >
              <img
                src={carWireframe}
                alt={t("car.wireframeAlt")}
                className="absolute bottom-0 right-0 w-full h-full object-contain scale-[3.5] "
              />
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
