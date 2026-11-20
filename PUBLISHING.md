# 发布说明

这是维护者文档。普通用户的安装方式见 `README.md`。

## 一次登录

只需要一次交互式登录。不要把 token 贴到聊天、Issue 或 commit 里。

```sh
gh auth login
gh auth status
```

`gh` 会把登录保存在自己的 hosts 文件里，下面的命令直接复用它。

## 准备

```sh
npm test
npm run test:package
for t in tests/*.test.mjs; do node "$t"; done
npm pack
```

产物（`files` 字段只含运行文件，tests/.github/bin 不进 tgz）：

```text
dsh-we-need-plugin-4.3.2.tgz
```

`npm pack` 字节可复现：同内容 + 同 package.json 产出同一 tgz（CI 与本地一致）。

## 上传（GitHub Git Data API 整树替换）

本项目用 Git Data API 整树替换上传：blob → tree → commit（parent=main）→ force-update main，**旧文件自动清除**（等价于"清空云端再粘贴新版"，原子且保留历史）。随后 release create/upload tgz。发布脚本见 `tmp/publish-4.3.2.mjs`（按版本复制改 `VERSION` / `REPO_DIR` / `TARBALL` / `NOTES`）。

staging 必须是**完整 repo**：运行文件 + `tests/`（CI `npm test` 需要）+ 脚手架（`.github/workflows/release.yml`、`bin/`、`.gitattributes`、`.gitignore`、`PUBLISHING.md`、`RELEASE-NOTES.md`）。live 安装目录只有运行文件，缺 tests/脚手架，不能直接当 staging。

```sh
node tmp/publish-4.3.2.mjs
```

若改用 git push：

```sh
git init
git config user.name "DSH We Need Plugin"
git config user.email "<id>+<login>@users.noreply.github.com"
git add .
git commit -m "release: dsh-we-need-plugin 4.3.2"
gh repo create Lichadai/dsh-we-need-plugin --public --source=. --remote=origin --push
```

使用 GitHub 的 noreply 邮箱，不要使用私人邮箱。

## 创建 Release

```sh
git tag v4.3.2
git push origin v4.3.2
gh release create v4.3.2 ./dsh-we-need-plugin-4.3.2.tgz --notes-file RELEASE-NOTES.md --latest
```

GitHub Actions（`.github/workflows/release.yml`）也会在 tag push 时 `npm test` + `npm run test:package` + `npm pack` 字节复现 tgz 并 create/upload release；手动命令与 CI 产物一致。

## npm（可选）

```sh
npm login
npm publish --access public
```

需要 npm 账号。包名是 `dsh-we-need-plugin`，`publishConfig.access` 已经是 `public`。

## 插件发现

- GitHub 仓库加 `dsh-plugin` topic；
- `package.json` 保留 `dsh-plugin`、`deepseek-harness` 关键词；
- 可选：把 DSH 插件索引 JSON 放到 GitHub Pages 或其他 HTTPS 静态主机。

## 推送前隐私检查

```sh
git status
git diff --cached
```

确认仓库不包含：

- `.env`、`.credentials.yaml`、token、cookie；
- DSH 会话日志或请求捕获；
- 本机绝对路径；
- reports、backups、`node_modules`、`.tgz`。