import { CircleSlash2, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import carWireframe from "@/assets/modus_wireframe.png";
import FuelIcon from "@/assets/icons/homeIcons/fuelConsumptionIcon.svg"

export interface CarStatusProps {
  fuelLevel?: number;
  consumption?: number;
  vehicleStatus?: string;
}

const defaultFuel = 72;
const defaultConsumption = 4.1;
const defaultStatus = "OK";

export function CarStatus({
  fuelLevel = defaultFuel,
  consumption = defaultConsumption,
  vehicleStatus = defaultStatus,
}: CarStatusProps) {
  return (
    <div className="flex-[0_0_30%] h-full min-w-75">
      <Card className="h-full border border-white/10 rounded-[20px] bg-[#0a0a0a]/10 backdrop-blur-md overflow-hidden">
        <CardContent className="flex h-full p-6 gap-6">
          <div className="flex flex-col justify-between h-full w-1/2">
            {/* Stats */}
            <div className="flex flex-col gap-4">
              {/* Fuel */}
              <div className="flex items-center gap-3">
                <img
                  src={FuelIcon}
                  className="w-9 h-9 text-warm-300 shrink-0"
                />
                <span className="text-2xl font-extrabold text-warm-300 tracking-tight">
                  {fuelLevel}%
                </span>
              </div>

              {/* Consumption */}
              <div className="flex items-center gap-3">
                <CircleSlash2
                  className="w-9 h-9 text-warm-300 shrink-0"
                  strokeWidth={2}
                />
                <span className="text-2xl font-extrabold text-warm-300 -tight">
                  {consumption.toFixed(1)} l/100km
                </span>
              </div>

              {/* Status */}
              <div className="flex items-center gap-3">
                <Check
                  className="w-9 h-9 text-warm-300 shrink-0"
                  strokeWidth={2}
                />
                <span className="text-2xl font-extrabold text-warm-300 tracking-tight">
                  {vehicleStatus}
                </span>
              </div>
            </div>

            {/* Car title at bottom-left — much bigger */}
            <h2 className="text-5xl font-extrabold text-warm-300 tracking-wide">
              Car
            </h2>
          </div>

          {/* RIGHT: Wireframe image — large, spills outside card to the right */}
          <div className="flex-1 relative overflow-visible">
            <img
              src={carWireframe}
              alt="Vehicle wireframe"
              className="absolute bottom-0 right-0 w-full h-full object-contain scale-[3.5] "
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
