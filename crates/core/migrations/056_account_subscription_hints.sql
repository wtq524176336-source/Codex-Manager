CREATE TABLE IF NOT EXISTS account_subscription_hints (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  subscription_account_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_subscription_hints_updated_at
  ON account_subscription_hints(updated_at DESC, account_id ASC);
