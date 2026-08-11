# Git Branching Guide

This guide defines CherryChat's short-lived branch convention. It is a reviewed
workflow rule, not an automated Git gate.

## Branch and task scope

Every code, documentation, configuration, or dependency change uses a branch
and Pull Request. A Trellis task is required only when the change needs
requirements, design, or explicit acceptance criteria.

| Change | Branch | Trellis task |
| --- | --- | --- |
| Feature or refactor needing design | `task/<task-directory-name>` | required |
| Small, understood bug fix | `fix/<short-name>` | not required |
| Documentation-only change | `docs/<short-name>` | not required |
| Dependency, configuration, or tooling change | `chore/<short-name>` | not required |

Several tiny edits may share one branch when they serve the same purpose. Do
not mix unrelated fixes merely to avoid creating another branch.

## Trellis task branch naming

Every Trellis task uses the same platform-neutral branch format:

```text
task/<task-directory-name>
```

For example, task directory `08-10-trellis-feature-branch-policy` uses
`task/08-10-trellis-feature-branch-policy`. Codex, Claude, and human
contributors all use this name; AI platform names do not belong in branches.

The task metadata must record:

| Field | Required value |
| --- | --- |
| `base_branch` | `main` |
| `branch` | `task/<task-directory-name>` |

Before implementation, the checked-out Git branch must equal the task's
`branch`, and it must not equal `base_branch`.

## Start implementation

Create the task branch from a clean `main` checkout:

```bash
git switch main
git pull --ff-only
git switch -c task/<task-directory-name>
python ./.trellis/scripts/task.py set-branch <task-dir> task/<task-directory-name>
python ./.trellis/scripts/task.py set-base-branch <task-dir> main
python ./.trellis/scripts/task.py start <task-dir>
```

If the task branch already exists, switch to it instead of creating it again.
`set-branch` and `set-base-branch` only update task metadata; they do not
switch Git branches.

Check the current branch and working directory before continuing:

```bash
git branch --show-current
git status --porcelain
```

Do not start implementation on `main`. If switching branches would affect
uncommitted work, stop and preserve those changes; do not reset, clean, or
discard them.

## Branch cleanup

Branches are temporary delivery units, not permanent environments. After a Pull
Request is merged, delete its remote head branch and then remove the local
branch after confirming that no uncommitted work remains. The repository should
enable GitHub's **Automatically delete head branches** setting so merged
branches do not accumulate.

## Why there is no `develop`

`main` remains the only integration and Pull Request target branch. A standard
`develop` workflow still creates short-lived feature branches and adds another
merge before `main`; it does not solve branch accumulation. Reconsider a
long-lived integration branch only if the project later needs a separately
maintained unreleased line or staging release train.

## Scope and boundaries

- This convention applies equally to Codex, Claude, and human contributors.
- The shared Trellis workflow and spec are the source of truth; no
  platform-specific root instruction file is required.
- Branch cleanup controls branch count; unrelated changes are not batched into
  a shared branch for convenience.
- Pull Request creation, merge, Tag, and Release remain separate operations.
