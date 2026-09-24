# Auth token rotation investigation

Unrelated to the billing deploy workspace. This file exists so tests can prove
workspace isolation: nothing in this file may appear when reading billing state.

## Findings

- Rotation succeeds for long-lived sessions but fails for short-lived ones.
- The old key is retired before the new token is flushed to replicas.
- UNRELATED_FINDING_SENTINEL_auth_token_rotation

## Next steps

- Add a replica-lag wait before retiring the previous signing key.
- Re-run the rotation drill against the staging auth service.
