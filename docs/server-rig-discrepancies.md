# Server Rig Discrepancies — 77.42.45.86

Audit date: 2026-06-30. For implementation by a dedicated agent.

## Current Server State

- OS: Linux (Debian/Ubuntu based)
- Claude Code: v2.1.195 installed at `/usr/bin/claude` — **NOT authenticated**
- Node: `/usr/bin/node` — present
- Everything else: **MISSING**

## Gaps vs Mac Setup

### Missing Tools (HIGH priority — needed for agent operation)

| Tool              | Mac Path                     | Server Status | Install Method                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh` (GitHub CLI) | `/opt/homebrew/bin/gh`       | missing       | `curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \| sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \| sudo tee /etc/apt/sources.list.d/github-cli.list && sudo apt update && sudo apt install gh` |
| `bun`             | `/Users/ultra/.bun/bin/bun`  | missing       | `curl -fsSL https://bun.sh/install \| bash`                                                                                                                                                                                                                                                                                                                                                        |
| `tg`              | `~/.agents/skills/tg/`       | missing       | Needs agent-tools + skill install                                                                                                                                                                                                                                                                                                                                                                  |
| `review`          | `review` CLI via agent-tools | missing       | Needs agent-tools install                                                                                                                                                                                                                                                                                                                                                                          |
| `draw`            | `draw` via agent-tools       | missing       | Needs agent-tools install                                                                                                                                                                                                                                                                                                                                                                          |
| `task`            | `task` via agent-tools       | missing       | Needs agent-tools install                                                                                                                                                                                                                                                                                                                                                                          |
| `rtk`             | `rtk` binary                 | missing       | Needs agent-tools install                                                                                                                                                                                                                                                                                                                                                                          |
| `linear`          | `linear` CLI                 | missing       | `npm install -g @linear/sdk` or via agent-tools                                                                                                                                                                                                                                                                                                                                                    |

### Claude Code Auth

- **Status**: installed v2.1.195, `~/.claude/auth.json` missing
- **Action needed**: Run `claude auth login` on server, capture OAuth URL, complete auth flow
- **Note**: Cannot run Claude agents until authenticated

### Agent Tools (`agent-tools`)

- **Mac location**: `/Users/ultra/xp/agent-tools/`
- **Server**: not found at `~/xp/agent-tools/` or `~/agent-tools/`
- **Action needed**:
  1. Clone agent-tools repo to server: `git clone <repo> ~/xp/agent-tools`
  2. Run installer: `~/xp/agent-tools/install.sh` or equivalent
  3. Add to PATH in `~/.bashrc` / `~/.zshrc`
  4. Install each skill: `tg install-skill`, `review install-skill`, `draw install-skill`

### rig.yaml

- **Mac**: rig.yaml routes `task` → Linear backend, team HYP
- **Server**: no rig.yaml present (agent-tools not installed)
- **Action needed**: Mirror Mac's rig.yaml task routing block after agent-tools install

## Implementation Order

1. Install `gh` + authenticate (`gh auth login`)
2. Install `bun`
3. Clone + install agent-tools
4. Authenticate Claude Code (`claude auth login` → OAuth URL → complete)
5. Install skills: `tg install-skill`, `review install-skill`, `draw install-skill`
6. Configure rig.yaml: copy task/Linear routing from Mac
7. Verify: `tg "test"` from server shell

## Notes

- Server has `node` at `/usr/bin/node` — agent-tools scripts that need node should work once installed
- k3s runs Postgres inside statefulsets (not accessible from host shell via psql) — `kubectl exec` needed for DB operations
- Disk at 81% (116G/150G) — killing k3s + removing `/var/lib/rancher` (70G) will bring disk to ~31% used
