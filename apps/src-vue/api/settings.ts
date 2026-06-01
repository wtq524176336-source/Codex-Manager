import { invoke } from "@/api/transport";

export function readSettings() {
  return invoke<Record<string, unknown>>("app_settings_get");
}
