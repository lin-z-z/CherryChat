# Release and version policy

**English** · [简体中文](./RELEASES_CN.md)

[Documentation](./README.md) · [Changelog](../CHANGELOG.md) ·
[Deployment](./DEPLOYMENT.md) · [Security](./SECURITY.md)

## Product maturity

CherryChat is currently Beta. Beta releases are usable and validated against
the repository quality gates, but may still change before `v1.0.0`. Beta does
not promise Stable compatibility, long-term support, hosted-service uptime, a
security response SLA, or enterprise support.

## Version numbers

Tracked releases use `v0.MINOR.PATCH` tags while the product remains Beta:

- `MINOR` introduces a meaningful compatible capability or deliberately
  revises an early product contract with migration and documentation.
- `PATCH` delivers compatible fixes, security hardening, or documentation and
  release corrections.
- `v1.0.0` is reserved for a separately reviewed Stable compatibility contract.

`package.json`, the root `package-lock.json` version, the current Changelog
section, Git tag, and GitHub Release must agree. Public tags are immutable.

## Release contents

CherryChat is a Web application and `private: true` npm package. A release
tracks source code and documentation; it does not publish npm packages,
desktop/mobile installers, containers, or custom build assets unless a future
policy explicitly adds them.

The release body contains the curated English Changelog section, a link to the
same-version Chinese Changelog, the target commit, and GitHub-generated Pull
Request, contributor, and full-Changelog information.

## Quality gates

A release candidate must be an exact commit merged into the default branch. Its
`CI` push workflow must complete successfully for that same SHA, including:

- formatting, documentation, zero-warning Lint, and strict TypeScript;
- coverage and script regression tests;
- production build, production and full dependency audits, and license listing;
- client-bundle sensitive-value scanning; and
- Chromium desktop and Mobile Chrome browser tests.

Repository CI does not replace a separate review of Vercel environment values,
Firewall rules, spending limits, Function logs, domain state, or upstream
provider behavior.

## Automated release flow

The `Release` GitHub Actions workflow is manually started with
`workflow_dispatch` on the default branch. It accepts no version or commit
inputs and performs these steps:

1. Lock the selected default-branch SHA and read the version from
   `package.json`.
2. Validate the package-lock version, Changelog sections, branch, and absence
   of the target Tag or Release.
3. Wait for the existing `CI` push run for the exact SHA; do not rerun the
   complete quality suite inside the Release workflow.
4. Generate GitHub notes and compose the reviewable Release body.
5. Make one Create Release request, allowing GitHub to create the matching Tag
   at the locked SHA.
6. Read back the Release and Tag target and print the verified URL.

The workflow alone receives `actions: read` and `contents: write`. Normal CI
keeps `contents: read`. The flow uses the repository `GITHUB_TOKEN`, not a PAT,
deployment credential, or third-party publishing Action.

## Failure and recovery

Any validation failure, missing/failed/cancelled CI run, timeout, conflict, or
notes-generation failure stops before the Create Release request and leaves no
remote Tag or Release.

If the Create Release response is ambiguous, the workflow reads back both
objects:

- matching Release and Tag at the locked SHA means success;
- neither object means the workflow failed and may be retried; and
- only one object, or a different Tag target, requires manual review.

Automation never deletes a public Release or moves/deletes a public Tag. After
publication, documentation errors may be corrected in the Release body and
repository, while product defects receive a new patch version such as
`v0.1.1`.

## Operator boundary

Preparing and merging the workflow is not approval to publish. Before each
remote release, review the candidate SHA, successful CI URL, composed notes,
and expected remote writes, then explicitly approve the workflow run.
