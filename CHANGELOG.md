# Changelog

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
