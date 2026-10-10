---
name: yantao
description: 个人认知工作台的暖纸调工具审美——token 镜像自 docs/yantao/design.md，规范源在该文档
colors:
  surface-primary: "#fbfaf7"
  surface-secondary: "#f1f0ec"
  surface-raised: "#fffdf7"
  text-primary: "#2e2b26"
  text-secondary: "#6b6455"
  text-muted: "#9a9488"
  border-subtle: "#e6e2d8"
  border-strong: "#d8d2c4"
  accent: "#4a7fd4"
  accent-text: "#3a66b5"
  accent-strong: "#3a66b5"
  accent-bg: "#eef3ff"
  accent-border: "#c7d7ff"
  success: "#4f9d5d"
  warning: "#d8a13a"
  warning-text: "#8a6d3a"
  warning-bg: "#fdf3d8"
  error: "#b4453a"
  error-bg: "#fbe9e7"
typography:
  display:
    fontFamily: "system-ui, 'Microsoft YaHei', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "system-ui, 'Microsoft YaHei', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "system-ui, 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
---

# yantao UI 设计（桥文件）

> **规范源：[`docs/yantao/design.md`](../../docs/yantao/design.md)。** 本文件只是把其中的机器可读部分（`--yt-*` token 家族）镜像成 impeccable 的 frontmatter 格式，供工具链（critique / live panel）消费。规则的解释权、修订史与完整示例都在规范源里——**修改设计请改那边，然后同步这里的 frontmatter**，不要在这里另立规则。

上面的 frontmatter 取的是**浅色主题**值作为正典（暗色值由 `theme-presenter.ts` 按主题写入，组件代码不感知主题切换）。所有颜色在组件代码里只能以 `var(--yt-*)` 引用，禁止裸十六进制。

## Overview

审美立场一句话：**颜色只在承载语义时使用，排版先于表面，静为默认**。这是 Vercel 式克制借原则不借资产、落在暖纸调工具审美上的结果。

## Colors

三层表面（primary 暖纸主底 / secondary 分组底 / raised 浮起层）、三档文字、两档边框、五档 accent（accent-strong 是实心主行动钮的唯一底色）、六档语义色。各 token 的语义分工见规范源第 2 节。

## Typography

五档字号（label 12 / body 13 / section 14 / title 16 / display 20）+ 两条字体栈（`--yt-font-ui` 界面文字、`--yt-font-code` 路径/ID/时间戳/代码）。页面级 display 至多一个。

## Layout

间距六档（4/8/12/16/24/32），**每个 gap 有且只有一个 owner**；同级条目用间距分界，分组能用间距表达就不用边框。详见规范源第 4 节。

## Elevation & Depth

平面体系，靠色调分层（surface-primary → secondary → raised）而非阴影制造层级。浮起层用 raised + border-subtle。

## Shapes

边框两档：`--yt-border-subtle` 默认分隔、`--yt-border-strong` 强调分组边界。圆角沿用现有惯例，未单独立 token。

## Components

两类表面构图规则截然不同：

- **阅读型表面**（会话流、实体记录、资源预览）：双层阅读、标题即论点、表格是证据、结尾落在决定。
- **操作型管理列表**（任务、调度、提议队列）：低频创作入口收起、主输入主角、行内动作顶对齐、从属证据独立成行、破坏性动作穿 ghost 装。

细则见规范源第 6、7 节。

## Do's and Don'ts

反模式清单以规范源第 8 节为准（不发明新颜色、不堆边框、不用 accent 当装饰、从属证据不缀正文尾部等）。已知欠账：`buttons.ts` 的 primaryButtonStyle 文字色应换成 `--yt-on-accent`（若该 token 落地）。
