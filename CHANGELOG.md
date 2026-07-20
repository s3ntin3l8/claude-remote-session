# Changelog

## [0.1.6](https://github.com/s3ntin3l8/tessera-session-manager/compare/v0.1.5...v0.1.6) (2026-07-20)


### Features

* native OIDC login ([#30](https://github.com/s3ntin3l8/tessera-session-manager/issues/30)) sharing Phase 1's session cookie ([#59](https://github.com/s3ntin3l8/tessera-session-manager/issues/59)) ([9595c4c](https://github.com/s3ntin3l8/tessera-session-manager/commit/9595c4cc8490ebaf71a2b6d3d75aa57f489be87e))
* optional in-process auth — shared-token gate + session cookie ([#19](https://github.com/s3ntin3l8/tessera-session-manager/issues/19)) ([#57](https://github.com/s3ntin3l8/tessera-session-manager/issues/57)) ([df376b8](https://github.com/s3ntin3l8/tessera-session-manager/commit/df376b899814f1203063d3dc6fdbf2f2a0339fc2))


### Bug Fixes

* sync terminal color scheme with app theme on toggle ([c108502](https://github.com/s3ntin3l8/tessera-session-manager/commit/c1085026c103d37321e59700827438c7259c5425))

## [0.1.5](https://github.com/s3ntin3l8/tessera-session-manager/compare/v0.1.4...v0.1.5) (2026-07-19)


### Features

* add agent internal API for multi-host sessions (issue [#26](https://github.com/s3ntin3l8/tessera-session-manager/issues/26), phase 2/N) ([#33](https://github.com/s3ntin3l8/tessera-session-manager/issues/33)) ([cecfb13](https://github.com/s3ntin3l8/tessera-session-manager/commit/cecfb13f40d7e428a027ba0d0f75bac82773ea55))
* add CI/CD Actions workflow status (issue [#27](https://github.com/s3ntin3l8/tessera-session-manager/issues/27), phase 5/N) ([#42](https://github.com/s3ntin3l8/tessera-session-manager/issues/42)) ([c185c6b](https://github.com/s3ntin3l8/tessera-session-manager/commit/c185c6b63fdb31f180aca21281f83975a537e4c9))
* add frontend host management for multi-host sessions ([#35](https://github.com/s3ntin3l8/tessera-session-manager/issues/35)) ([0bea94f](https://github.com/s3ntin3l8/tessera-session-manager/commit/0bea94f851f572689d9bf687051b5ea34f2cfc72))
* add GitHub Dock widget, panel, and + menu entry (issue [#27](https://github.com/s3ntin3l8/tessera-session-manager/issues/27), phase 3/N) ([#40](https://github.com/s3ntin3l8/tessera-session-manager/issues/40)) ([6bbd10e](https://github.com/s3ntin3l8/tessera-session-manager/commit/6bbd10e74c820ae8c7d583ae591cf6a0d2600655))
* add GitHub integration credential storage + Settings UI (issue [#27](https://github.com/s3ntin3l8/tessera-session-manager/issues/27), phase 1/N) ([#38](https://github.com/s3ntin3l8/tessera-session-manager/issues/38)) ([b2eb833](https://github.com/s3ntin3l8/tessera-session-manager/commit/b2eb83374c67ba302b56725b8b03b2492b19b2da))
* add GitHub OAuth device flow (issue [#27](https://github.com/s3ntin3l8/tessera-session-manager/issues/27), phase 4/N) ([#41](https://github.com/s3ntin3l8/tessera-session-manager/issues/41)) ([96bab0a](https://github.com/s3ntin3l8/tessera-session-manager/commit/96bab0aa877e21d9b1c213a8ee616ebffd8b34f4))
* add multi-host role scaffolding for sessions (issue [#26](https://github.com/s3ntin3l8/tessera-session-manager/issues/26), phase 1/N) ([d79e253](https://github.com/s3ntin3l8/tessera-session-manager/commit/d79e253dde5dab8f3f336a6a945cfb038d9fc2df))
* add owner/repo derivation + per-project GitHub status API (issue [#27](https://github.com/s3ntin3l8/tessera-session-manager/issues/27), phase 2/N) ([#39](https://github.com/s3ntin3l8/tessera-session-manager/issues/39)) ([5d1d191](https://github.com/s3ntin3l8/tessera-session-manager/commit/5d1d191a4bae944ca6edfb304c557f90de5568ef))
* add primary-side host routing/proxy for multi-host sessions (issue [#26](https://github.com/s3ntin3l8/tessera-session-manager/issues/26), phase 3/N) ([#34](https://github.com/s3ntin3l8/tessera-session-manager/issues/34)) ([5dfc263](https://github.com/s3ntin3l8/tessera-session-manager/commit/5dfc2634b0259ab1cbb7af5aae8298dfbddf0774))
* browser pane panel, triggers, dev-URL config UI (issue [#28](https://github.com/s3ntin3l8/tessera-session-manager/issues/28), phase 4/N) ([#46](https://github.com/s3ntin3l8/tessera-session-manager/issues/46)) ([a5a164b](https://github.com/s3ntin3l8/tessera-session-manager/commit/a5a164bc2ae5f588c26b5833c0a61f28d8e225be))
* dev-server port auto-discovery (issue [#28](https://github.com/s3ntin3l8/tessera-session-manager/issues/28), phase 7/N) ([#49](https://github.com/s3ntin3l8/tessera-session-manager/issues/49)) ([f1a2544](https://github.com/s3ntin3l8/tessera-session-manager/commit/f1a2544111bb685aab974f1aa070e6ab843a45c1))
* direct-embed browser pane fallback when PREVIEW_BASE_HOST is unset ([#52](https://github.com/s3ntin3l8/tessera-session-manager/issues/52)) ([9ec27b7](https://github.com/s3ntin3l8/tessera-session-manager/commit/9ec27b72132f2703ea1a4ef2a5275c38e31fb240))
* external-URL previews with SSRF guards (issue [#28](https://github.com/s3ntin3l8/tessera-session-manager/issues/28), phase 5/N) ([#47](https://github.com/s3ntin3l8/tessera-session-manager/issues/47)) ([22d4029](https://github.com/s3ntin3l8/tessera-session-manager/commit/22d40290743fdcd3ec041b86668a8533a48a0b1d))
* HMR websocket proxying for browser panes (issue [#28](https://github.com/s3ntin3l8/tessera-session-manager/issues/28), phase 3/N) ([#45](https://github.com/s3ntin3l8/tessera-session-manager/issues/45)) ([92d0c73](https://github.com/s3ntin3l8/tessera-session-manager/commit/92d0c73d38e7dee1f9c87d92e74d942ff0d01ad2))
* multi-host two-hop preview + wildcard deploy templates (issue [#28](https://github.com/s3ntin3l8/tessera-session-manager/issues/28), phase 6/N) ([#48](https://github.com/s3ntin3l8/tessera-session-manager/issues/48)) ([70dbeef](https://github.com/s3ntin3l8/tessera-session-manager/commit/70dbeef525d848cc9220f5a063d0e2b7f2bd88cf))
* preview config, slug registry, base-host wiring (issue [#28](https://github.com/s3ntin3l8/tessera-session-manager/issues/28), phase 1/N) ([#43](https://github.com/s3ntin3l8/tessera-session-manager/issues/43)) ([5960d8b](https://github.com/s3ntin3l8/tessera-session-manager/commit/5960d8b407b5ea1b6ab8d7d1492c159b7a35cf97))
* resizeable, per-workspace split-column dock ([#53](https://github.com/s3ntin3l8/tessera-session-manager/issues/53)) ([f8a9fcd](https://github.com/s3ntin3l8/tessera-session-manager/commit/f8a9fcdc6e8752efce479007c99fb88ed4667718))
* subdomain HTTP reverse proxy for local dev servers (issue [#28](https://github.com/s3ntin3l8/tessera-session-manager/issues/28), phase 2/N) ([#44](https://github.com/s3ntin3l8/tessera-session-manager/issues/44)) ([346136e](https://github.com/s3ntin3l8/tessera-session-manager/commit/346136e0d3994e79274d5ffd3ac70ff69d83a9e0))
* versioned-release prod deploy + in-app auto-update ([#54](https://github.com/s3ntin3l8/tessera-session-manager/issues/54)) ([9886e2d](https://github.com/s3ntin3l8/tessera-session-manager/commit/9886e2de7f49da0a0fd7e341548c5fb6e97951da))

## [0.1.4](https://github.com/s3ntin3l8/tessera-session-manager/compare/v0.1.3...v0.1.4) (2026-07-17)


### Features

* brand as Tessera ([79d1251](https://github.com/s3ntin3l8/tessera-session-manager/commit/79d125111244f3981cedc49dcaa14e5a82a7f19c))
* **ci:** add Claude Code GitHub Workflow ([#16](https://github.com/s3ntin3l8/tessera-session-manager/issues/16)) ([8f9479e](https://github.com/s3ntin3l8/tessera-session-manager/commit/8f9479ed8f0fabbe01a82b9f652b7d323d906248))
* **ci:** add on-demand [@mention](https://github.com/mention) review alongside auto-review ([#15](https://github.com/s3ntin3l8/tessera-session-manager/issues/15)) ([ef78d1e](https://github.com/s3ntin3l8/tessera-session-manager/commit/ef78d1e5ac33496ab123b3fed777e1ac64308744))
* **ci:** auto-review PRs with Hermes bot ([#12](https://github.com/s3ntin3l8/tessera-session-manager/issues/12)) ([28ebf6e](https://github.com/s3ntin3l8/tessera-session-manager/commit/28ebf6ea8f3ca31c4d748d976c232ea26d8f09ae))
* make the toolbar notification bell interactive ([#20](https://github.com/s3ntin3l8/tessera-session-manager/issues/20)) ([b544f01](https://github.com/s3ntin3l8/tessera-session-manager/commit/b544f017d672d30ff32967393341b8d3d98fb684))
* restore quick trash/rename actions and tidy the projects tree ([#25](https://github.com/s3ntin3l8/tessera-session-manager/issues/25)) ([eaf4eb5](https://github.com/s3ntin3l8/tessera-session-manager/commit/eaf4eb5bad89221c9a5d1e3dac95364610d53cff))
* rework settings page with server-persisted preferences ([#13](https://github.com/s3ntin3l8/tessera-session-manager/issues/13)) ([a1b4ed6](https://github.com/s3ntin3l8/tessera-session-manager/commit/a1b4ed688832f5d471bb6241eb30fccf90543d8b))


### Bug Fixes

* **ci:** auto-review only on PR open, not every push ([#17](https://github.com/s3ntin3l8/tessera-session-manager/issues/17)) ([e74a968](https://github.com/s3ntin3l8/tessera-session-manager/commit/e74a968097f23f0786e29b1f0414638a77dbb5ef))
* **ci:** correct claude_args flag name (--allowedTools) ([#18](https://github.com/s3ntin3l8/tessera-session-manager/issues/18)) ([fc98bab](https://github.com/s3ntin3l8/tessera-session-manager/commit/fc98bab2382caf54a6e46a7c20e0edf33d9d0544))
* **ci:** restrict Hermes on-demand review to trusted commenters ([#21](https://github.com/s3ntin3l8/tessera-session-manager/issues/21)) ([7e65308](https://github.com/s3ntin3l8/tessera-session-manager/commit/7e65308c1b3f64ed750597fdd2a5f766d499e2cb))

## [0.1.3](https://github.com/s3ntin3l8/claude-remote-session/compare/v0.1.2...v0.1.3) (2026-07-16)


### Features

* add pi coding agent support with official logo ([bdd2350](https://github.com/s3ntin3l8/claude-remote-session/commit/bdd235045a8b90719c8ce73c993d38518ef1dab6))
* backend support for the UI redesign (server-info, project edit, group color) ([b37a4ce](https://github.com/s3ntin3l8/claude-remote-session/commit/b37a4ceba2cfbf89148111c5c9b16f0825ad41aa))
* design tokens/theming + API/store plumbing for the UI redesign ([15948c3](https://github.com/s3ntin3l8/claude-remote-session/commit/15948c3e22fc9202985c6c0295e9ef5b4bcee862))
* frontend redesign foundation — fonts, icons, vitest, reorder logic ([13b0eda](https://github.com/s3ntin3l8/claude-remote-session/commit/13b0eda402affceb729aee12c85530df02c40d66))
* inline "New workspace" input in place of the button ([cf07656](https://github.com/s3ntin3l8/claude-remote-session/commit/cf0765671c74c7fd06a5b44b5e31f8e000ac5b65))
* pane chrome, split actions, connection/failure states, app wiring ([8c15dd0](https://github.com/s3ntin3l8/claude-remote-session/commit/8c15dd053c0825c07f0b33e974c3f71927f70c56))
* show official CLI logos in the session launcher ([0da413f](https://github.com/s3ntin3l8/claude-remote-session/commit/0da413fbc8c66f8cf68443123ae6e5b492425445))
* sidebar redesign — groups, status badges, discovery, dock, drag-and-drop ([5de60e5](https://github.com/s3ntin3l8/claude-remote-session/commit/5de60e59489db0f25a2e9ed9b68c4021124a1bba))
* toolbar, settings, command palette, and shared modal components ([2f81f4c](https://github.com/s3ntin3l8/claude-remote-session/commit/2f81f4ccb676da0e199952aa752d230cb3c70780))


### Bug Fixes

* batch of small UX/correctness fixes across sidebar, sessions, theming ([be14879](https://github.com/s3ntin3l8/claude-remote-session/commit/be14879cae0fb39653434cd81f7aba41adfaa7a9))
* workspace drag-to-reorder cancelling instantly for ungrouped items ([3e73061](https://github.com/s3ntin3l8/claude-remote-session/commit/3e730618f78f5fb077ccf96a4403e7ce60630f9a))

## [0.1.2](https://github.com/s3ntin3l8/claude-remote-session/compare/v0.1.1...v0.1.2) (2026-07-12)


### Features

* retroactive changelog entry for discovery/launchers/groups/dock/status plumbing ([bf2eb58](https://github.com/s3ntin3l8/claude-remote-session/commit/bf2eb5870c1d84f4a60b0f14b32dabea63b891cc))


### Bug Fixes

* correct invalid identify tags in .pre-commit-config.yaml ([#3](https://github.com/s3ntin3l8/claude-remote-session/issues/3)) ([cc93c58](https://github.com/s3ntin3l8/claude-remote-session/commit/cc93c586b74199185632fc799dcdb066d5c07f76))

## [0.1.1](https://github.com/s3ntin3l8/claude-remote-session/compare/v0.1.0...v0.1.1) (2026-07-12)


### Features

* M1 vertical slice — dtach terminal bridge, verified GO ([554af52](https://github.com/s3ntin3l8/claude-remote-session/commit/554af5273c571def19f34c100ceb50267857a994))
* M2 multi-session backend — Drizzle registry + REST API, verified GO ([e9ec984](https://github.com/s3ntin3l8/claude-remote-session/commit/e9ec984d81fd2010a5c36bdf20ce12a5f01e07a1))
* M3 tiled frontend — Vite/React/dockview dashboard, verified GO ([b2d5540](https://github.com/s3ntin3l8/claude-remote-session/commit/b2d554022ad0a8a024b416646b5000e47e72632d))
* M4 deployment prep — Dockerfile fix, static serving, drafted deploy configs ([48427fc](https://github.com/s3ntin3l8/claude-remote-session/commit/48427fc9d7a3307ed808381943cbc997c5046d2f))
* M5 polish — reconnect/backpressure, key conflicts, mobile layout, coverage floor ([0199c5c](https://github.com/s3ntin3l8/claude-remote-session/commit/0199c5c497a1ffff0cdd791c98c7da774086209c))
* named workspaces — persistent, switchable dockview layouts (cmux gap [#1](https://github.com/s3ntin3l8/claude-remote-session/issues/1)) ([b9158f4](https://github.com/s3ntin3l8/claude-remote-session/commit/b9158f450abc96fe8e888bfb70144bbe84033705))


### Bug Fixes

* allowlist secrets: inherit false positives, enable strict detect-secrets ([fbf51b5](https://github.com/s3ntin3l8/claude-remote-session/commit/fbf51b5dd070831d168607499a5211268a58f512))
* attribute LICENSE copyright to Björn Hansen, not the s3ntin3l8 handle ([92039de](https://github.com/s3ntin3l8/claude-remote-session/commit/92039de19fa11b18cb7c5218746b8ec56a5325fc))
* emit raw json coverage report for Codecov ingestion ([3321b93](https://github.com/s3ntin3l8/claude-remote-session/commit/3321b935218dce4581ec50f3d30bfd21b2af5d64))
* override esbuild to 0.28.1 to close two moderate advisories ([0f0378f](https://github.com/s3ntin3l8/claude-remote-session/commit/0f0378f39116430c2ce1cce2f951017370be07d9))
* use mkdtempSync for test temp dirs, closing CodeQL alert [#1](https://github.com/s3ntin3l8/claude-remote-session/issues/1) ([efc5b62](https://github.com/s3ntin3l8/claude-remote-session/commit/efc5b62fbb10d40f0a1830555ffc0ecaaa6f0c04))

## Changelog

All notable changes to this project will be documented here by
[Release Please](https://github.com/googleapis/release-please), driven by
[Conventional Commits](https://www.conventionalcommits.org/).
