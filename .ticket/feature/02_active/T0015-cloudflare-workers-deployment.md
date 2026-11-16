---
id: T0015
type: feature
title: "Cloudflare Workers本番デプロイ構成"
status: active
priority: P1
owner: P1
created: 2026-11-16
updated: 2026-11-16
---

# T0015 Cloudflare Workers本番デプロイ構成

## 目的

React/Vite SPAとHono APIをCloudflare Workersへ統合し、D1/R2の開発・本番環境を分離して安全にデプロイできるようにする。

## 受け入れ条件

- [ ] Cloudflare Vite Pluginまたは同等のWorkers Static Assets構成を導入する
- [ ] SPAのクライアントルーティングが直接URLアクセスでも動作する
- [ ] D1/R2のproduction bindingをdevelopmentと分離する
- [ ] Secretをソース管理せず、デプロイ手順をREADMEに記載する
- [ ] `pnpm build`と`pnpm wrangler deploy`の検証手順を追加する

## activity

- 2026-11-16: Cloudflare Workersを推奨デプロイ先として整理。現状はWeb ViteビルドとAPI Wrangler設定が分離しているため、統合構成を次フェーズで実装する。
