import { invoke } from "@/api/transport";

export function openInBrowser(url: string) {
  return invoke("open_in_browser", { url });
}
