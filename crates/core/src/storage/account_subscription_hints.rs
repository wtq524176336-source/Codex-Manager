use rusqlite::{Result, Row};

use super::{now_ts, AccountSubscriptionHint, Storage};

impl Storage {
    /// 函数 `upsert_account_subscription_hint`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-05-15
    ///
    /// # 参数
    /// - account_id: 参数 account_id
    /// - subscription_account_id: 参数 subscription_account_id
    ///
    /// # 返回
    /// 返回函数执行结果
    pub fn upsert_account_subscription_hint(
        &self,
        account_id: &str,
        subscription_account_id: Option<&str>,
    ) -> Result<()> {
        let Some(subscription_account_id) = normalize_optional_text(subscription_account_id) else {
            return self.delete_account_subscription_hint(account_id);
        };

        self.conn.execute(
            "INSERT INTO account_subscription_hints (
                account_id,
                subscription_account_id,
                updated_at
            ) VALUES (
                ?1,
                ?2,
                ?3
            )
            ON CONFLICT(account_id) DO UPDATE SET
                subscription_account_id = excluded.subscription_account_id,
                updated_at = excluded.updated_at",
            (account_id, subscription_account_id, now_ts()),
        )?;
        Ok(())
    }

    /// 函数 `delete_account_subscription_hint`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-05-15
    ///
    /// # 参数
    /// - account_id: 参数 account_id
    ///
    /// # 返回
    /// 返回函数执行结果
    pub fn delete_account_subscription_hint(&self, account_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM account_subscription_hints WHERE account_id = ?1",
            [account_id],
        )?;
        Ok(())
    }

    /// 函数 `find_account_subscription_hint`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-05-15
    ///
    /// # 参数
    /// - account_id: 参数 account_id
    ///
    /// # 返回
    /// 返回函数执行结果
    pub fn find_account_subscription_hint(
        &self,
        account_id: &str,
    ) -> Result<Option<AccountSubscriptionHint>> {
        let mut stmt = self.conn.prepare(
            "SELECT account_id, subscription_account_id, updated_at
             FROM account_subscription_hints
             WHERE account_id = ?1
             LIMIT 1",
        )?;
        let mut rows = stmt.query([account_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(map_account_subscription_hint_row(row)?))
        } else {
            Ok(None)
        }
    }

    /// 函数 `ensure_account_subscription_hints_table`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-05-15
    ///
    /// # 参数
    /// - self: 参数 self
    ///
    /// # 返回
    /// 返回函数执行结果
    pub(super) fn ensure_account_subscription_hints_table(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS account_subscription_hints (
                account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
                subscription_account_id TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_account_subscription_hints_updated_at
                ON account_subscription_hints(updated_at DESC, account_id ASC);",
        )?;
        Ok(())
    }
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn map_account_subscription_hint_row(row: &Row<'_>) -> Result<AccountSubscriptionHint> {
    Ok(AccountSubscriptionHint {
        account_id: row.get(0)?,
        subscription_account_id: row.get(1)?,
        updated_at: row.get(2)?,
    })
}
