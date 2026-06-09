UPDATE api_keys
SET rotation_strategy = 'account_rotation',
    aggregate_api_id = NULL
WHERE rotation_strategy = 'hybrid_rotation';
