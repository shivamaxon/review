# Live associate verification

2026-10-24T08:13:26.853Z · jxduyylphokqpignybpz.supabase.co

| Check | Result | Detail |
|---|---|---|
| Migration 7 installed | PASS |  |
| Save live nonhistorical meeting | PASS |  |
| Retry returns same meeting | PASS |  |
| Save newer follow-up | PASS |  |
| Synthetic rows are not historical | PASS |  |
| Older-entry edit has before/after audit | PASS |  |
| Undo restores the older remark | PASS |  |
| Offline cancellation blocks delayed save | PASS |  |
| Undo removes newly saved follow-up | PASS |  |
| Synthetic records removed from active lists | PASS |  |
| Every historical row unchanged | PASS |  |

## Initial failures and correction

The first cleanup tried to Undo the original receipt after later edits; the optimistic version guard correctly refused it. Cleanup was changed to soft-delete only the explicitly marked, nonhistorical synthetic lead and its synthetic children. A targeted cleanup removed the first run's test rows; the complete rerun passed all checks above. No historical record was edited.

The first script also used Supabase's default global sign-out while closing its test session. This could have signed Udit Nigam out on other devices. It did not change his password or profile. The scripts now explicitly use `signOut({scope:'local'})`; subsequent sessions were closed locally only.

A final read-only historical verifier run on 24 October 2026 passed all 80 comparisons. Nothing was deployed.
