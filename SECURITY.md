# Security Policy

## Reporting

Please do not open a public issue containing API keys, tokens, cookies, session logs, or private prompts.

Use GitHub's private security advisory flow for this repository, or contact the maintainer through the repository profile. Include:

- affected version;
- DSH version;
- a minimal reproduction;
- whether the issue can leak credentials or execute code outside the DSH Host.

## Scope

This plugin runs inside the DSH Host process and makes outbound model requests to upstream endpoints configured in `cordis.patch.yml`.

The package does not include credentials, request captures, telemetry, session logs, or a test harness.

`apiKeyEnv` values are references. The actual values are resolved from the DSH credentials service or the process environment.

## Safe installation

Only install bundles from sources you trust. Review `index.js` and `cordis.patch.yml` before installation, especially the `baseURL` and `interceptModels` entries.
