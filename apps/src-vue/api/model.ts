import { invoke, withAddr } from "@/api/transport";
import { normalizeModelList } from "@/api/normalize";

export async function listModels() {
  const result = await invoke<unknown>(
    "service_model_catalog_list",
    withAddr(),
  );
  return normalizeModelList(result);
}
