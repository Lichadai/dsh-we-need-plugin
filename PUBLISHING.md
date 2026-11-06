# Publishing

This document is for maintainers. The normal user install path is in `README.md`.

## One-time login

Only one interactive login is needed. Do not paste a token into chat, an issue, or a commit.

```sh
gh auth login
gh auth status
```

`gh` stores the login in its own hosts file. The release commands below reuse it.

## Prepare

```sh
npm test
npm pack
```

The tarball is `weneed-native-seed-0.4.0.tgz`.

## Create the repository and push

```sh
git init
git config user.name "WeNeed Native Seed"
git config user.email "<id>+<login>@users.noreply.github.com"
git add .
git commit -m "release: weneed-native-seed 0.4.0"
gh repo create <account>/weneed-native-seed --public --source=. --remote=origin --push
```

Use GitHub's noreply address for the commit email. Do not use a private email address.

## Create the release

```sh
git tag v0.4.0
git push origin v0.4.0
gh release create v0.4.0 ./weneed-native-seed-0.4.0.tgz --generate-notes
```

The GitHub Actions workflow also creates a release on tag pushes. Running the command manually is optional if the workflow is enabled.

## npm (optional)

```sh
npm login
npm publish --access public
```

Requires an npm account and a public package name. The package is already named `weneed-native-seed` and has `publishConfig.access: public`.

## Plugin discovery

- Add the GitHub topic `dsh-plugin`.
- Keep `dsh-plugin` and `deepseek-harness` in `package.json` keywords.
- Optional: publish a DSH plugin index JSON on GitHub Pages or another HTTPS host.

## Privacy check before pushing

```sh
git status
git diff --cached
```

Confirm that the repository does not contain:

- `.env`, `.credentials.yaml`, tokens, cookies;
- DSH session logs or request captures;
- local absolute paths;
- reports, backups, `node_modules`, or `.tgz` files.
