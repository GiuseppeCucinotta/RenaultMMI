import { Smartphone } from "lucide-react";
import { PlaceholderView } from "./PlaceholderView";
import { useI18n } from "@/i18n";

export function PhoneView() {
  const { t } = useI18n();
  return <PlaceholderView icon={Smartphone} label={t("nav.phone")} />;
}
