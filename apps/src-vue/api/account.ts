import { invoke, withAddr } from "@/api/transport";
import { asObject, asString, normalizeAccountList } from "@/api/normalize";

export interface AccountListParams {
  page?: number;
  pageSize?: number;
}

export interface LoginStartResult {
  type: string;
  loginId: string;
  authUrl: string;
  verificationUrl: string | null;
  userCode: string | null;
}

export interface LoginStatusResult {
  status: string;
  error: string;
}

export interface AccountWarmupItemResult {
  accountId: string;
  accountName: string;
  ok: boolean;
  message: string;
}

export interface AccountWarmupResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: AccountWarmupItemResult[];
}

export interface AccountTokenRefreshItemResult {
  accountId: string;
  accountName: string;
  ok: boolean;
  message: string;
}

export interface AccountTokenRefreshAllResult {
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: AccountTokenRefreshItemResult[];
}

const MAX_IMPORT_RPC_BODY_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_ERROR_ITEMS = 50;

export async function listAccounts(params: AccountListParams = {}) {
  const result = await invoke<unknown>(
    "service_account_list",
    withAddr({ page: params.page ?? 1, pageSize: params.pageSize ?? 500 }),
  );
  return normalizeAccountList(result);
}

export function refreshAccounts(accountId?: string) {
  const target = accountId?.trim();
  return invoke(
    "service_usage_refresh",
    withAddr(target ? { accountId: target, account_id: target } : {}),
  );
}

export function refreshAccountTokens(accountId?: string) {
  const target = accountId?.trim() || null;
  return invoke(
    "service_chatgpt_auth_tokens_refresh",
    withAddr({ accountId: target, previousAccountId: target }),
  );
}

export function refreshAllAccountTokens() {
  return invoke<unknown>("service_chatgpt_auth_tokens_refresh_all", withAddr()).then(
    normalizeAccountTokenRefreshAllResult,
  );
}

export function deleteAccount(accountId: string) {
  return invoke("service_account_delete", withAddr({ accountId }));
}

export function deleteAccounts(accountIds: string[]) {
  return invoke("service_account_delete_many", withAddr({ accountIds }));
}

export function deleteAccountsByStatuses(statuses: string[]) {
  return invoke("service_account_delete_by_statuses", withAddr({ statuses }));
}

export function updateAccountProfile(
  accountId: string,
  params: {
    label?: string | null;
    note?: string | null;
    tags?: string[] | string | null;
    preferred?: boolean;
    status?: string | null;
  },
) {
  return invoke(
    "service_account_update",
    withAddr({
      accountId,
      label: params.label ?? null,
      note: params.note ?? null,
      tags: Array.isArray(params.tags) ? params.tags.join(",") : params.tags ?? null,
      preferred: typeof params.preferred === "boolean" ? params.preferred : null,
      status: params.status ?? null,
    }),
  );
}

function createEmptyImportResult() {
  return {
    total: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [] as Array<{ index?: number; message?: string }>,
  };
}

function estimateImportRequestBytes(contents: string[]): number {
  return new TextEncoder().encode(JSON.stringify({ contents })).length;
}

function splitImportContents(contents: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const content of contents) {
    const next = current.concat(content);
    if (current.length > 0 && estimateImportRequestBytes(next) > MAX_IMPORT_RPC_BODY_BYTES) {
      chunks.push(current);
      current = [content];
      if (estimateImportRequestBytes(current) > MAX_IMPORT_RPC_BODY_BYTES) {
        throw new Error("单条导入内容过大，请拆分后重试");
      }
      continue;
    }
    current = next;
  }

  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

function mergeImportResult(
  target: ReturnType<typeof createEmptyImportResult>,
  payload: unknown,
  indexOffset: number,
) {
  const source = asObject(payload);
  target.total += asNumber(source.total);
  target.created += asNumber(source.created);
  target.updated += asNumber(source.updated);
  target.failed += asNumber(source.failed);

  const errors = Array.isArray(source.errors) ? source.errors : [];
  for (const error of errors) {
    if (target.errors.length >= MAX_IMPORT_ERROR_ITEMS) {
      break;
    }
    const item = asObject(error);
    target.errors.push({
      index: asNumber(item.index) + indexOffset,
      message: asString(item.message),
    });
  }
}

export async function importAccounts(contents: string[]) {
  const batches = splitImportContents(contents);
  if (!batches.length) {
    return createEmptyImportResult();
  }

  const merged = createEmptyImportResult();
  let processed = 0;
  for (const batch of batches) {
    const result = await invoke<unknown>("service_account_import", withAddr({ contents: batch }));
    mergeImportResult(merged, result, processed);
    processed += batch.length;
  }
  return merged;
}

export function importAccountsByFile() {
  return invoke("service_account_import_by_file", withAddr());
}

export function importAccountsByDirectory() {
  return invoke("service_account_import_by_directory", withAddr());
}

export function exportAccounts(selectedAccountIds: string[], exportMode: "single" | "multiple") {
  return invoke(
    "service_account_export_by_account_files",
    withAddr({ selectedAccountIds, exportMode }),
  );
}

export function warmupAccounts(accountIds: string[] = [], message = "hi") {
  return invoke<unknown>("service_account_warmup", withAddr({ accountIds, message })).then(
    normalizeWarmupResult,
  );
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeWarmupResult(payload: unknown): AccountWarmupResult {
  const source = asObject(payload);
  const results = Array.isArray(source.results)
    ? source.results
        .map((item) => {
          const row = asObject(item);
          return {
            accountId: asString(row.accountId ?? row.account_id),
            accountName: asString(row.accountName ?? row.account_name),
            ok: asBoolean(row.ok),
            message: asString(row.message),
          };
        })
        .filter((item) => item.accountId || item.accountName || item.message)
    : [];
  return {
    requested: asNumber(source.requested, results.length),
    succeeded: asNumber(source.succeeded, results.filter((item) => item.ok).length),
    failed: asNumber(source.failed, results.filter((item) => !item.ok).length),
    results,
  };
}

function normalizeAccountTokenRefreshAllResult(payload: unknown): AccountTokenRefreshAllResult {
  const source = asObject(payload);
  const results = Array.isArray(source.results)
    ? source.results
        .map((item) => {
          const row = asObject(item);
          return {
            accountId: asString(row.accountId ?? row.account_id),
            accountName: asString(row.accountName ?? row.account_name),
            ok: asBoolean(row.ok),
            message: asString(row.message),
          };
        })
        .filter((item) => item.accountId || item.accountName || item.message)
    : [];
  return {
    requested: asNumber(source.requested, results.length),
    succeeded: asNumber(source.succeeded, results.filter((item) => item.ok).length),
    failed: asNumber(source.failed, results.filter((item) => !item.ok).length),
    skipped: asNumber(source.skipped, 0),
    results,
  };
}

function normalizeLoginStartResult(payload: unknown): LoginStartResult {
  const source = asObject(payload);
  const verificationUrl = asString(source.verificationUrl ?? source.verification_url);
  return {
    type: asString(source.type ?? source.loginType ?? source.login_type),
    loginId: asString(source.loginId ?? source.login_id),
    authUrl: asString(source.authUrl ?? source.auth_url ?? verificationUrl),
    verificationUrl: verificationUrl || null,
    userCode: asString(source.userCode ?? source.user_code) || null,
  };
}

function normalizeLoginStatus(payload: unknown): LoginStatusResult {
  const source = asObject(payload);
  return {
    status: asString(source.status),
    error: asString(source.error ?? source.message),
  };
}

export async function startLogin(params: {
  loginType?: string;
  openBrowser?: boolean;
  note?: string | null;
  tags?: string[] | string | null;
  groupName?: string | null;
  workspaceId?: string | null;
}) {
  const result = await invoke<unknown>(
    "service_login_start",
    withAddr({
      loginType: params.loginType || "chatgpt",
      openBrowser: params.openBrowser ?? true,
      note: params.note || null,
      tags: Array.isArray(params.tags) ? params.tags.join(",") : params.tags || null,
      groupName: params.groupName || null,
      workspaceId: params.workspaceId || null,
    }),
  );
  return normalizeLoginStartResult(result);
}

export async function getLoginStatus(loginId: string) {
  const result = await invoke<unknown>("service_login_status", withAddr({ loginId }));
  return normalizeLoginStatus(result);
}

export function completeLogin(state: string, code: string, redirectUri?: string | null) {
  return invoke("service_login_complete", withAddr({ state, code, redirectUri: redirectUri || null }));
}

export function loginWithChatgptAuthTokens(params: {
  accessToken: string;
  refreshToken?: string | null;
  idToken?: string | null;
  chatgptAccountId?: string | null;
  workspaceId?: string | null;
  chatgptPlanType?: string | null;
}) {
  return invoke(
    "service_login_chatgpt_auth_tokens",
    withAddr({
      accessToken: params.accessToken,
      refreshToken: params.refreshToken || null,
      idToken: params.idToken || null,
      chatgptAccountId: params.chatgptAccountId || null,
      workspaceId: params.workspaceId || null,
      chatgptPlanType: params.chatgptPlanType || null,
    }),
  );
}
