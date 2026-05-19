use crate::account_availability::{evaluate_snapshot, Availability};
use crate::account_plan::resolve_account_plan;
use crate::account_status::set_account_status;
use codexmanager_core::storage::{now_ts, Storage, UsageSnapshotRecord};
use codexmanager_core::usage::parse_usage_snapshot;

const DEFAULT_USAGE_SNAPSHOTS_RETAIN_PER_ACCOUNT: usize = 0;
const USAGE_SNAPSHOTS_RETAIN_PER_ACCOUNT_ENV: &str =
    "CODEXMANAGER_USAGE_SNAPSHOTS_RETAIN_PER_ACCOUNT";
const FIVE_HOUR_WINDOW_MINUTES: i64 = 300;

fn usage_status_updates_blocked(current_status: &str) -> bool {
    current_status.trim().eq_ignore_ascii_case("disabled")
}

fn is_primary_five_hour_only(record: &UsageSnapshotRecord) -> bool {
    record.window_minutes == Some(FIVE_HOUR_WINDOW_MINUTES)
        && record.used_percent.is_some()
        && record.secondary_used_percent.is_none()
        && record.secondary_window_minutes.is_none()
}

fn is_known_free_account(
    storage: &Storage,
    account_id: &str,
    previous_snapshot: Option<&UsageSnapshotRecord>,
) -> bool {
    if let Ok(Some(subscription)) = storage.find_account_subscription(account_id) {
        if !subscription.has_subscription {
            return true;
        }
    }

    let token = storage.find_token_by_account_id(account_id).ok().flatten();
    resolve_account_plan(token.as_ref(), previous_snapshot)
        .map(|plan| plan.normalized == "free")
        .unwrap_or(false)
}

fn should_ignore_free_primary_five_hour_snapshot(
    storage: &Storage,
    record: &UsageSnapshotRecord,
    previous_snapshot: Option<&UsageSnapshotRecord>,
) -> bool {
    is_primary_five_hour_only(record)
        && is_known_free_account(storage, &record.account_id, previous_snapshot)
}

/// 函数 `usage_snapshots_retain_per_account`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 返回函数执行结果
fn usage_snapshots_retain_per_account() -> usize {
    std::env::var(USAGE_SNAPSHOTS_RETAIN_PER_ACCOUNT_ENV)
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_USAGE_SNAPSHOTS_RETAIN_PER_ACCOUNT)
}

/// 函数 `apply_status_from_snapshot`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 返回函数执行结果
pub(crate) fn apply_status_from_snapshot(
    storage: &Storage,
    record: &UsageSnapshotRecord,
) -> Availability {
    let availability = evaluate_snapshot(record);
    let current_status = storage
        .find_account_by_id(&record.account_id)
        .ok()
        .flatten()
        .map(|account| account.status)
        .unwrap_or_default();

    if usage_status_updates_blocked(&current_status) {
        return availability;
    }

    match availability {
        Availability::Available => {
            set_account_status(storage, &record.account_id, "active", "usage_ok");
        }
        Availability::Unavailable("usage_exhausted_primary" | "usage_exhausted_secondary") => {
            set_account_status(
                storage,
                &record.account_id,
                "limited",
                "usage_limit_exhausted",
            );
        }
        Availability::Unavailable(_) => {}
    }
    availability
}

/// 函数 `store_usage_snapshot`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 返回函数执行结果
pub(crate) fn store_usage_snapshot(
    storage: &Storage,
    account_id: &str,
    value: serde_json::Value,
) -> Result<(), String> {
    // 解析并写入用量快照
    let parsed = parse_usage_snapshot(&value);
    let record = UsageSnapshotRecord {
        account_id: account_id.to_string(),
        used_percent: parsed.used_percent,
        window_minutes: parsed.window_minutes,
        resets_at: parsed.resets_at,
        secondary_used_percent: parsed.secondary_used_percent,
        secondary_window_minutes: parsed.secondary_window_minutes,
        secondary_resets_at: parsed.secondary_resets_at,
        credits_json: parsed.credits_json,
        captured_at: now_ts(),
    };
    let previous_snapshot = storage
        .latest_usage_snapshot_for_account(account_id)
        .map_err(|e| e.to_string())?;
    if should_ignore_free_primary_five_hour_snapshot(storage, &record, previous_snapshot.as_ref()) {
        log::warn!(
            "ignore primary-only five-hour usage snapshot for free account: account_id={}",
            account_id
        );
        return Ok(());
    }
    storage
        .insert_usage_snapshot(&record)
        .map_err(|e| e.to_string())?;
    let retain = usage_snapshots_retain_per_account();
    if retain > 0 {
        let _ = storage.prune_usage_snapshots_for_account(account_id, retain);
    }
    let _ = apply_status_from_snapshot(storage, &record);
    if let Err(err) = crate::account_auto_switch::switch_exhausted_free_preferred_account() {
        log::warn!("auto switch exhausted free preferred account failed: {err}");
    }
    Ok(())
}
