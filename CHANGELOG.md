# Changelog

## 0.6.0

- Renamed the project/package to `dsh-we-need-plugin` (DSH We Need Plugin); the hyphen separates We and need for readability.
- README now includes an optional System Prompt tail with the exact 728/728 seed.
- GitHub repository renamed to `Lichadai/dsh-we-need-plugin`.

## 0.5.0

- Renamed the project to `dsh-weneed-plugin` (DSH WeNeed Plugin).
- Added the Chinese-first README section on WeNeed as a thinking style, attention scattering, and the Qoder boundary.
- Added guidance on tool/workspace/skill overhead and delaying tool calls.
- GitHub repository renamed to `Lichadai/dsh-weneed-plugin`.

## 0.4.0

- Release package is interception-only: no extra `weneed-native` provider is registered.
- Default `targetRules` is now `[deepseek, flash]`.
- Removed test harness, request capture, `systemTail`, and local absolute paths from the release package.
- Added detailed README covering seed positions, provider routes, future model filters, DSH upgrades, privacy, and publishing.
- Added release tests, MIT license, security policy, and GitHub release workflow.

## 0.3.0

- Added provider-agnostic model matching for DeepSeek 4.1.
- Added provider-scoped `interceptModels` routes.
- Added BAICAI and OpenDesign interception examples.
- Added Kimi K3.1 and DeepSeek V4 Pro target-rule examples for local testing.
