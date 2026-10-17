# Contributing

Thanks for helping out. This project uses Git Flow and every change starts from an issue.

## Workflow

1. **Open or pick an issue.** Every change, however small, is tied to an issue. Discuss larger changes there before writing code.
2. **Create a branch from `develop`:**
   - `feature/<issue#>-slug` for new functionality
   - `bugfix/<issue#>-slug` for bug fixes
   - `chore/<slug>` for cleanup and tooling
3. **Open a PR into `develop`.** Fill in the PR template and reference the issue with `Closes #<issue#>`.
4. **Get review and resolve all conversations**, then merge once CI is green.

Branches:

| Branch | Purpose | Starts from | PR target |
|---|---|---|---|
| `main` | Released code only | — | — |
| `develop` | Integration branch, default branch | — | — |
| `feature/<issue#>-slug` | New functionality | `develop` | `develop` |
| `bugfix/<issue#>-slug` | Bug fixes | `develop` | `develop` |
| `chore/<slug>` | Cleanup, tooling | `develop` | `develop` |
| `release/X.Y.Z` | Release preparation | `develop` | `main` |
| `hotfix/X.Y.Z` | Urgent fix to a released version | `main` | `main` |

## Releases

1. Create `release/X.Y.Z` from `develop`, bump the version there, and turn the `## Unreleased` section of
   `CHANGELOG.md` into `## X.Y.Z — <date>`: a short summary of the release, then `### New`, `### Improved`,
   `### Fixed` and `### Known issues` as needed, written for users (what changed and how to use it).
2. Open a PR from `release/X.Y.Z` into `main`.
3. After merging, tag the merge commit on `main` as `vX.Y.Z`.
4. Merge `main` back into `develop` so the release commits and version bump are kept.

Pushing the tag triggers the `release` workflow. It fails unless the tag equals `v` plus the `version` in
`package.json`; otherwise it runs lint and tests, builds the `linux-x64` and `win32-x64` VSIX files, and
publishes a GitHub Release with the VSIX files attached. The release notes are the version's `CHANGELOG.md`
section (`node scripts/changelog-section.mjs X.Y.Z` prints it), followed by GitHub's list of merged PRs. The
`publish` job then uploads the same VSIX files to each store that is switched on:

| Store | Repository variable | Secret |
|---|---|---|
| VS Code Marketplace | `PUBLISH_MARKETPLACE=true` | `VSCE_PAT`: Azure DevOps PAT, organization *All accessible organizations*, scope *Marketplace → Manage* |
| Open VSX | `PUBLISH_OPENVSX=true` | `OVSX_PAT`: open-vsx.org access token (namespace `AleFire99` must exist) |

Re-running the workflow for a version that is already published skips it instead of failing.

## Hotfixes

1. Create `hotfix/X.Y.Z` from `main`.
2. Open a PR into `main` and tag `vX.Y.Z` after merge.
3. Back-merge `main` into `develop`, as with releases.

## Branch protection

Both `main` and `develop` are protected:

- Changes arrive through a pull request; direct pushes are not allowed.
- Force pushes are not allowed.
- All review conversations must be resolved before merging.
- Required CI status checks apply once CI is set up.

## Development setup

Requirements: **Node.js 22**.

```sh
npm ci
scripts/fetch-cpn.sh   # downloads CPN IDE binaries into resources/
```

The binaries in `resources/` are downloaded, never committed. Do not add them to git.

To run the extension, open the repository in VS Code and press **F5** to launch an Extension Development Host.

## Testing

```sh
npm run lint && npm run typecheck
npm test                                 # unit tests
node scripts/gen-examples.mjs --check    # examples/*.cpn match their text sources
CPN_IT=1 npm test                        # also runs the real-backend tests (needs resources/ and Java 17)
npm run test:integration                 # VS Code integration suite (CPN_IT=1 adds the backend-dependent tests)
```

The simulator daemon uses the fixed port 20001, so real-backend tests need it free (and run one file at a time). To run
them next to a running CPN IDE, use a network namespace: `unshare -rn sh -c 'ip link set lo up; CPN_IT=1 npx vitest run'`.

If you use Python tooling, manage it with `uv`: create environments with `uv venv` and run commands with `uv run`.

## Commit messages

- Use the imperative mood: "Add retry to backend check", not "Added" or "Adds".
- Keep the subject line short, and explain the why in the body when it is not obvious.
- Reference the issue, for example `Refs #12` or `Closes #12`.
