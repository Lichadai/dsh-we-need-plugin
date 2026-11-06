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
npm pack
```

产物：

```text
dsh-weneed-plugin-0.5.0.tgz
```

## 创建仓库并推送

```sh
git init
git config user.name "DSH WeNeed Plugin"
git config user.email "<id>+<login>@users.noreply.github.com"
git add .
git commit -m "release: dsh-weneed-plugin 0.5.0"
gh repo create Lichadai/dsh-weneed-plugin --public --source=. --remote=origin --push
```

使用 GitHub 的 noreply 邮箱，不要使用私人邮箱。

如果 `git push` 被网络重置，可以改用 GitHub Git Data API 上传文件、commit、tag 和 Release；本项目的上传脚本是 `tools/publish-release-api.mjs`。

## 创建 Release

```sh
git tag v0.5.0
git push origin v0.5.0
gh release create v0.5.0 ./dsh-weneed-plugin-0.5.0.tgz --generate-notes
```

GitHub Actions 也会在 tag push 时创建 Release；手动命令是可选的。

## npm（可选）

```sh
npm login
npm publish --access public
```

需要 npm 账号。包名是 `dsh-weneed-plugin`，`publishConfig.access` 已经是 `public`。

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
