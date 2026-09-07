/**
 * Locale dictionaries for the yantao workbench plugin (namespace
 * `yantao-kb`): tree sections, badges, session actions, and editor chrome.
 * @module @deepseek-ai/dsh-client-ui-yantao-kb/locales
 */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** yantao workbench copy. */
    'yantao-kb': YantaoKbKey
  }
}

/** Dictionary keys owned by this plugin. */
export type YantaoKbKey = keyof typeof zh

/** 中文词典（yantao 的工作语言）。 */
export const zh = {
  'section.resources': '资源',
  'section.projects': '项目',
  'section.areas': '领域',
  'section.people': '人物',
  'section.sessions': '会话',
  'tree.refresh': '刷新',
  'tree.empty': '（空）',
  'tree.loadFailed': '知识库加载失败',
  'session.new': '新建会话',
  'session.live': '进行中',
  'badge.archived': '已归档',
  'badge.note': '笔记',
  'editor.source': '源码',
  'editor.preview': '预览',
  'editor.save': '保存',
  'editor.saved': '已保存',
  'editor.dirty': '未保存',
  'editor.empty': '在左侧选择一个文件开始编辑',
  'editor.loading': '加载中…',
  'editor.loadFailed': '加载失败',
  'editor.readonly': '原始材料只读；请编辑它的影子笔记',
  'editor.saveFailed': '保存失败',
  'markdown.copy': '复制',
  'markdown.copied': '已复制',
  'markdown.footnotes': '脚注',
} as const

/** English dictionary. */
export const en: Record<YantaoKbKey, string> = {
  'section.resources': 'Resources',
  'section.projects': 'Projects',
  'section.areas': 'Areas',
  'section.people': 'People',
  'section.sessions': 'Sessions',
  'tree.refresh': 'Refresh',
  'tree.empty': '(empty)',
  'tree.loadFailed': 'Failed to load the knowledge base',
  'session.new': 'New session',
  'session.live': 'running',
  'badge.archived': 'Archived',
  'badge.note': 'Note',
  'editor.source': 'Source',
  'editor.preview': 'Preview',
  'editor.save': 'Save',
  'editor.saved': 'Saved',
  'editor.dirty': 'Unsaved',
  'editor.empty': 'Select a file on the left to start editing',
  'editor.loading': 'Loading…',
  'editor.loadFailed': 'Failed to load',
  'editor.readonly': 'Originals are read-only; edit the shadow note instead',
  'editor.saveFailed': 'Failed to save',
  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
}

/** This plugin's dictionary namespace. */
export const NS = 'yantao-kb'
