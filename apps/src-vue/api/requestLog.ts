import { invoke, withAddr } from "@/api/transport";
import { normalizeRequestLogList } from "@/api/normalize";

export async function listRequestLogs() {
  const result = await invoke<unknown>(
    "service_requestlog_list",
    withAddr({
      query: "",
      statusFilter: "all",
      page: 1,
      pageSize: 100,
      startTs: null,
      endTs: null,
    }),
  );
  return normalizeRequestLogList(result);
}
