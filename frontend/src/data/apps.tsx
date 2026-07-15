import { Sliders, ListMusic, Gauge, ScanEye, Settings } from "lucide-react";

import tripComputerIcon from "@/assets/icons/apps/tripComputer.svg";
import tripHistoryIcon from "@/assets/icons/apps/tripHistory.svg";
import parkingSensorIcon from "@/assets/icons/apps/parkingSensor.svg";

export interface AppItem {
  id: string;
  name: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

export const DEFAULT_APPS: AppItem[] = [
  { id: "fuel", name: "Fuel", icon: <img src={tripComputerIcon} alt="Fuel" className="w-38" /> },
  { id: "equalizer", name: "Equalizer", icon: <Sliders className="w-20 h-20" /> },
  { id: "music", name: "Playlist", icon: <ListMusic className="w-20 h-20" /> },
  { id: "speed", name: "Speedometer", icon: <Gauge className="w-20 h-20" /> },
  { id: "nav-history", name: "History", icon: <img src={tripHistoryIcon} alt="History" className="w-20 h-20" /> },
  { id: "camera", name: "Camera", icon: <ScanEye className="w-20 h-20" /> },
  { id: "parking", name: "Parking", icon: <img src={parkingSensorIcon} alt="Parking" className="w-20 h-20" /> },
  { id: "settings", name: "Settings", icon: <Settings className="w-20 h-20" /> },
];
