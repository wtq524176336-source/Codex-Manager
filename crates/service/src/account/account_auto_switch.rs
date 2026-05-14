use std::collections::HashMap;

use codexmanager_core::storage::{Account, Token, UsageSnapshotRecord};

use crate::account_availability::{evaluate_snapshot, Availability};
use crate::account_plan::resolve_account_plan;
use crate::storage_helpers::open_storage;

/// 函数 `switch_exhausted_free_preferred_account`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 返回切换后的账号 ID
pub(crate) fn switch_exhausted_free_preferred_account() -> Result<Option<String>, String> {
    let mut storage = open_storage().ok_or_else(|| "storage unavailable".to_string())?;
    let preferred_account_id = storage
        .preferred_account_id()
        .map_err(|err| format!("load preferred account failed: {err}"))?;
    let Some(preferred_account_id) = preferred_account_id else {
        return Ok(None);
    };

    let preferred_account = storage
        .find_account_by_id(&preferred_account_id)
        .map_err(|err| format!("load preferred account failed: {err}"))?;
    let Some(preferred_account) = preferred_account else {
        return Ok(None);
    };

    let preferred_token = storage
        .find_token_by_account_id(&preferred_account_id)
        .map_err(|err| format!("load preferred token failed: {err}"))?;
    let Some(preferred_token) = preferred_token else {
        return Ok(None);
    };

    let preferred_snapshot = storage
        .latest_usage_snapshot_for_account(&preferred_account_id)
        .map_err(|err| format!("load preferred usage failed: {err}"))?;

    let preferred_snapshot_exhausted = preferred_snapshot
        .as_ref()
        .map(is_exhausted_snapshot)
        .unwrap_or(false);
    if !is_free_account(&preferred_token, preferred_snapshot.as_ref())
        || (!preferred_snapshot_exhausted && !is_limited_account(&preferred_account))
    {
        return Ok(None);
    }

    let accounts = storage
        .list_accounts()
        .map_err(|err| format!("list accounts failed: {err}"))?;
    let tokens = storage
        .list_tokens()
        .map_err(|err| format!("list tokens failed: {err}"))?
        .into_iter()
        .map(|token| (token.account_id.clone(), token))
        .collect::<HashMap<_, _>>();
    let snapshots = storage
        .latest_usage_snapshots_by_account()
        .map_err(|err| format!("list usage snapshots failed: {err}"))?
        .into_iter()
        .map(|snapshot| (snapshot.account_id.clone(), snapshot))
        .collect::<HashMap<_, _>>();

    let Some(next_account_id) =
        find_next_available_free_account(&accounts, &tokens, &snapshots, &preferred_account_id)
    else {
        return Ok(None);
    };

    storage
        .set_preferred_account(Some(&next_account_id))
        .map_err(|err| format!("switch preferred account failed: {err}"))?;
    crate::gateway::invalidate_candidate_cache();
    log::info!(
        "auto switched exhausted free preferred account: {} -> {}",
        preferred_account_id,
        next_account_id
    );
    Ok(Some(next_account_id))
}

fn find_next_available_free_account(
    accounts: &[Account],
    tokens: &HashMap<String, Token>,
    snapshots: &HashMap<String, UsageSnapshotRecord>,
    current_account_id: &str,
) -> Option<String> {
    let current_index = accounts
        .iter()
        .position(|account| account.id == current_account_id)?;

    accounts
        .iter()
        .skip(current_index + 1)
        .chain(accounts.iter().take(current_index))
        .find(|account| {
            is_enabled_account(account)
                && tokens
                    .get(&account.id)
                    .zip(snapshots.get(&account.id))
                    .map(|(token, snapshot)| {
                        is_free_account(token, Some(snapshot)) && is_available_snapshot(snapshot)
                    })
                    .unwrap_or(false)
        })
        .map(|account| account.id.clone())
}

fn is_enabled_account(account: &Account) -> bool {
    !matches!(
        account.status.trim().to_ascii_lowercase().as_str(),
        "unavailable" | "limited" | "banned" | "disabled"
    )
}

fn is_limited_account(account: &Account) -> bool {
    account.status.trim().eq_ignore_ascii_case("limited")
}

fn is_free_account(token: &Token, snapshot: Option<&UsageSnapshotRecord>) -> bool {
    resolve_account_plan(Some(token), snapshot)
        .map(|plan| plan.normalized == "free")
        .unwrap_or(false)
}

fn is_exhausted_snapshot(snapshot: &UsageSnapshotRecord) -> bool {
    matches!(
        evaluate_snapshot(snapshot),
        Availability::Unavailable("usage_exhausted_primary" | "usage_exhausted_secondary")
    )
}

fn is_available_snapshot(snapshot: &UsageSnapshotRecord) -> bool {
    matches!(evaluate_snapshot(snapshot), Availability::Available)
}
