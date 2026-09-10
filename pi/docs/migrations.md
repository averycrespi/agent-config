# Migration notes

Guidance for older installations. For current components, see the [Pi configuration reference](../README.md).

## Legacy workflow retirement

The legacy `.design` lifecycle and its `architect`, `specify`, `plan`, `advance-plan`, and `create-jira-ticket` skill packages have been retired. Use [direct authorized work or the Plane ticket workflow](../../README.md#working-with-the-agent); old plan-run helpers and skill commands are no longer available.

Existing local `.design` artifacts are not deleted or migrated automatically. Treat them as historical context, verify their claims against current repository state, and explicitly re-scope any unfinished work before continuing. Do not attempt to resume an old run with the removed helper.

## Goal extension retirement

The Goal extension and its `goal` tool and `/goal*` commands have been retired. Remove any explicit Goal extension load paths, `extension:goal` settings, and `GOAL_*` environment overrides from local configuration, then restart Pi or run `/reload`. Existing Goal snapshots in session history are left untouched; they no longer restore active steering or auto-run. Ticket delivery may use Loop for optional bounded continuation, not mandatory execution choreography.

## Ticket checkpoint and CI recovery

Current ticket delivery uses session-bound Monitor observations for CI waiting, not Loop polling. For existing checkpoints, interrupted registrations, or legacy `.pi/tickets/` state, follow the [work-ticket recovery procedure](../agent/skills/work-ticket/references/recovery.md). Do not delete or overwrite historical artifacts to restart delivery.
