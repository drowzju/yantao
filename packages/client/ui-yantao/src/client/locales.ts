/**
 * Copy dictionaries for the yantao workbench shell (namespace
 * `yantao.workbench`). zh is the key source of truth; en is checked against
 * it at compile time. The workbench is a plain child of the root frame, not
 * a slot entry, so its components receive the bound `t` as a prop threaded
 * from the plugin's `apply` — see `WorkbenchT` below.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** The workbench locale namespace. */
export const WORKBENCH_NS = 'yantao.workbench'

/** The bound translate face threaded through the workbench component tree. */
export type WorkbenchT = TranslateNS<'yantao.workbench'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'yantao.workbench': WorkbenchLocaleKey
  }
}

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  // Common
  'common.cancel': '取消',
  'common.name': '名称',
  'common.empty': '（空）',

  // Workbench sections (tabs, @-menu grouping, placeholders)
  'section.resource': '资源',
  'section.todo': '待办',
  'section.meeting': '会议',
  'section.capability': '能力',
  'section.domain': '领域',
  'section.person': '人物',
  'section.project': '项目',

  // Person relations
  'relation.self': '自己',
  'relation.subordinate': '下属',
  'relation.superior': '上级',
  'relation.peer': '同事',
  'relation.external': '外部',
  'relation.label': '关系',
  'relation.ownerFixed': '知识库主人，不可改',

  // Workbench frame and rails
  'workbench.archived': '· 已归档',
  'workbench.capabilityLabel': '能力',
  'workbench.deleteConfirm': '删除「{name}」',
  'workbench.deleteIrreversible': '不可撤销，确认删除？',
  'workbench.delete': '删除',
  'workbench.expandIntake': '展开输入栏',
  'workbench.expandWorkspace': '展开工作栏',
  'workbench.newButton': '+ 新建',
  'workbench.refine': '提炼',
  'workbench.meetingPlaceholder': '会议名称',
  'workbench.entityNamePlaceholder': '{section}名称',
  'frame.closeNotice': '点击关闭',

  // Capability panel
  'capability.empty': '还没有能力。把能力目录拷进 .dsh/skills/，或新建一个。',
  'capability.unregisteredHeading': '未注册技能（ADR-0025）',
  'capability.adoptTitle': '采纳「{name}」？',
  'capability.adoptCopyTo': '将整个目录复制到 {path}，原处保留。',
  'capability.adoptRouteTo': '并在中央路由 {path} 写入：',
  'capability.adoptSidecarNote': '注意：该技能自带 yantao.json 声明，副本中的该文件会被删除，外带声明不会静默生效。',
  'capability.adoptConfirm': '采纳',
  'capability.registerTitle': '注册「{name}」为能力',
  'capability.registerRepoNote': '这是插件仓库：注册将在 {path} 为内含技能（{names}）各写一条路由，仓库目录原地保留。',
  'capability.registerSimpleNote': '在 {path} 写入一条路由，技能目录原地保留（不移动、不改名）。',
  'capability.reachAgent': '允许 agent 调用（kb_run_capability）',
  'capability.reachAllResources': '出现在所有资源的右键菜单',
  'capability.reachSelection': '出现在中间区右键菜单（选中文字＝提示词，无选中＝当前文件为对象）',
  'capability.routePreview': '将写入的路由条目：',
  'capability.registerConfirm': '注册',
  'capability.newButton': '+ 新建能力',
  'capability.namePlaceholder': '能力名称（如 paper-digest）',
  'capability.backToList': '← 返回清单',
  'capability.instructionNote': '指令型能力：没有脚本，agent 调用时返回下面的 SKILL.md 指令正文',
  'capability.openedToAgent': '已对 agent 开放（kb_run_capability）',
  'capability.accepts': '接受：',
  'capability.lastRun': '上次运行：',

  // Mail panel
  'mail.stage.creatingSession': '正在创建会话…',
  'mail.stage.askingModel': '正在向模型提问…',
  'mail.stage.analysing': '模型正在逐批分析邮件…',
  'mail.importance.key': '重点',
  'mail.importance.digest': '汇总',
  'mail.importance.normal': '普通',
  'mail.prev': '← 往前',
  'mail.next': '往后 →',
  'mail.loading': '读取中…',
  'mail.description': '能力「邮件」：Outlook（COM 子进程）。「往后」读最新的一批，「往前」往更早读一段；读取后由 agent 分析，确认后才写库。',
  'mail.countUnit': '{count} 封 ·',
  'mail.morePending': '（还有更多）',
  'mail.noSubject': '（无主题）',
  'mail.processed': '已处理：',
  'mail.rangeTo': '到',
  'mail.longGap': '上次读取是一个多月前，中间那段还没读过。',
  'mail.analysing': '分析中…',
  'mail.analyseBatch': '分析这 {count} 封',
  'mail.analysedProgress': '（已分析 {done}/{total}）',
  'mail.waited': '（已等待 {seconds} 秒）',

  // Todo board
  'todo.newAria': '新待办',
  'todo.unnamed': '（未命名）',
  'todo.edit': '编辑',
  'todo.delete': '删除',
  'todo.title': '标题',
  'todo.due': '截止日期',
  'todo.bodyPlaceholder': '正文（markdown）',
  'todo.body': '正文',
  'todo.save': '保存',
  'todo.loading': '载入中…',
  'todo.todoColumn': 'TODO',
  'todo.doneColumn': 'DONE',
  'todo.addTitle': '新增待办',
  'todo.openFull': '打开全文',

  // File editor
  'editor.status.loading': '载入中',
  'editor.status.saved': '已保存',
  'editor.status.dirty': '未保存',
  'editor.status.saving': '保存中',
  'editor.status.failed': '失败',
  'editor.status.conflict': '冲突',
  'editor.conflictNote': '此文件在别处已被修改，未自动保存。',
  'editor.overwrite': '覆盖',
  'editor.discardMine': '放弃我的修改',
  'editor.hideDiff': '隐藏差异',
  'editor.showDiff': '查看差异',
  'editor.mine': '我的修改',
  'editor.server': '服务器版本',

  // Markdown view
  'md.copy': '复制',
  'md.copied': '已复制',
  'md.footnotes': '脚注',
  'md.collapseProps': '收起属性',
  'md.props': '属性',
  'md.empty': '（无内容）',
  'md.collapseOutline': '收起大纲',
  'md.outline': '大纲',
  'md.openExternallyTitle': '用系统关联的编辑器打开（通常是 Obsidian）',
  'md.openInObsidian': '在 Obsidian 中打开',
  'md.collapseBacklinks': '收起反向链接',
  'md.backlinks': '反向链接',

  // Read-only file banner
  'readonly.note': '只读（资源原样不改写）',

  // Center pane
  'center.conversation': '对话',
  'center.close': '关闭',
  'center.read': '阅读',
  'center.source': '源码',

  // Onboarding
  'onboarding.title': '选择知识库目录',
  'onboarding.description': 'yantao 把知识库存成纯 Markdown 文件。选择一个空目录或已有知识库目录，缺少的结构会自动创建。',
  'onboarding.busy': '处理中…',
  'onboarding.choose': '选择目录',

  // Proposal card
  'proposal.highlight': '重点提醒',
  'proposal.digest': '日常通知（汇总）',
  'proposal.empty': '这次没有发现值得进入知识库的内容。',
  'proposal.acceptAll': '全部接受',
  'proposal.ignoreAll': '全部忽略',
  'proposal.confirmWrite': '确认写入（{count}）',

  // Selection menu
  'selection.title': '选中文字',
  'selection.send': '发送到会话',
  'selection.capability': '能力',
  'selection.runOnFile': '对当前文件调用能力',

  // Proposal groups (ProposalCard headings)
  'group.createEntity': '新建实体',
  'group.projectUpdate': '项目动态',
  'group.writeState': '写状态',
  'group.resource': '资源',
  'group.domainLink': '领域关联',
  'group.todo': '待办',
  'group.editSection': '章节改写',
} satisfies Record<string, string>

/** Workbench locale key union. */
export type WorkbenchLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  // Common
  'common.cancel': 'Cancel',
  'common.name': 'Name',
  'common.empty': '(empty)',

  // Workbench sections
  'section.resource': 'Resources',
  'section.todo': 'Todos',
  'section.meeting': 'Meetings',
  'section.capability': 'Capabilities',
  'section.domain': 'Domains',
  'section.person': 'People',
  'section.project': 'Projects',

  // Person relations
  'relation.self': 'Self',
  'relation.subordinate': 'Reports to me',
  'relation.superior': 'My manager',
  'relation.peer': 'Colleague',
  'relation.external': 'External',
  'relation.label': 'Relation',
  'relation.ownerFixed': 'KB owner, not editable',

  // Workbench frame and rails
  'workbench.archived': '· archived',
  'workbench.capabilityLabel': 'Capability',
  'workbench.deleteConfirm': 'Delete "{name}"',
  'workbench.deleteIrreversible': 'This cannot be undone. Delete?',
  'workbench.delete': 'Delete',
  'workbench.expandIntake': 'Expand intake rail',
  'workbench.expandWorkspace': 'Expand workspace rail',
  'workbench.newButton': '+ New',
  'workbench.refine': 'Refine',
  'workbench.meetingPlaceholder': 'Meeting name',
  'workbench.entityNamePlaceholder': '{section} name',
  'frame.closeNotice': 'Click to close',

  // Capability panel
  'capability.empty': 'No capabilities yet. Copy a capability directory into .dsh/skills/, or create one.',
  'capability.unregisteredHeading': 'Unregistered skills (ADR-0025)',
  'capability.adoptTitle': 'Adopt "{name}"?',
  'capability.adoptCopyTo': 'Copy the whole directory to {path}, keeping the original in place.',
  'capability.adoptRouteTo': 'And write into the central routing file {path}:',
  'capability.adoptSidecarNote': 'Note: this skill ships its own yantao.json declaration; that file is removed from the copy so an out-of-tree declaration never takes effect silently.',
  'capability.adoptConfirm': 'Adopt',
  'capability.registerTitle': 'Register "{name}" as a capability',
  'capability.registerRepoNote': 'This is a plugin repository: registering writes one route into {path} for each contained skill ({names}); the repository directory stays in place.',
  'capability.registerSimpleNote': 'Writes one route into {path}; the skill directory stays in place (no move, no rename).',
  'capability.reachAgent': 'Allow agent invocation (kb_run_capability)',
  'capability.reachAllResources': 'Show in the right-click menu of every resource',
  'capability.reachSelection': 'Show in the center-pane right-click menu (selected text = prompt; no selection = current file)',
  'capability.routePreview': 'Route entry to be written:',
  'capability.registerConfirm': 'Register',
  'capability.newButton': '+ New capability',
  'capability.namePlaceholder': 'Capability name (e.g. paper-digest)',
  'capability.backToList': '← Back to the list',
  'capability.instructionNote': 'Instruction capability: no script; agent invocation returns the SKILL.md instruction body below',
  'capability.openedToAgent': 'Opened to the agent (kb_run_capability)',
  'capability.accepts': 'Accepts:',
  'capability.lastRun': 'Last run:',

  // Mail panel
  'mail.stage.creatingSession': 'Creating the session…',
  'mail.stage.askingModel': 'Asking the model…',
  'mail.stage.analysing': 'The model is analysing the mail in batches…',
  'mail.importance.key': 'Key',
  'mail.importance.digest': 'Digest',
  'mail.importance.normal': 'Normal',
  'mail.prev': '← Earlier',
  'mail.next': 'Later →',
  'mail.loading': 'Reading…',
  'mail.description': 'Capability "Mail": Outlook (COM subprocess). "Later" reads the newest batch, "Earlier" steps back in time; after reading, the agent analyses and only confirmed results are written to the KB.',
  'mail.countUnit': '{count} messages ·',
  'mail.morePending': '(more pending)',
  'mail.noSubject': '(no subject)',
  'mail.processed': 'Processed:',
  'mail.rangeTo': 'to',
  'mail.longGap': 'The last read was over a month ago; everything in between is unread.',
  'mail.analysing': 'Analysing…',
  'mail.analyseBatch': 'Analyse these {count} messages',
  'mail.analysedProgress': '({done}/{total} analysed)',
  'mail.waited': '(waited {seconds}s)',

  // Todo board
  'todo.newAria': 'New todo',
  'todo.unnamed': '(untitled)',
  'todo.edit': 'Edit',
  'todo.delete': 'Delete',
  'todo.title': 'Title',
  'todo.due': 'Due date',
  'todo.bodyPlaceholder': 'Body (markdown)',
  'todo.body': 'Body',
  'todo.save': 'Save',
  'todo.loading': 'Loading…',
  'todo.todoColumn': 'TODO',
  'todo.doneColumn': 'DONE',
  'todo.addTitle': 'Add a todo',
  'todo.openFull': 'Open full text',

  // File editor
  'editor.status.loading': 'Loading',
  'editor.status.saved': 'Saved',
  'editor.status.dirty': 'Unsaved',
  'editor.status.saving': 'Saving',
  'editor.status.failed': 'Failed',
  'editor.status.conflict': 'Conflict',
  'editor.conflictNote': 'This file was modified elsewhere; not auto-saved.',
  'editor.overwrite': 'Overwrite',
  'editor.discardMine': 'Discard my changes',
  'editor.hideDiff': 'Hide diff',
  'editor.showDiff': 'Show diff',
  'editor.mine': 'My changes',
  'editor.server': 'Server version',

  // Markdown view
  'md.copy': 'Copy',
  'md.copied': 'Copied',
  'md.footnotes': 'Footnotes',
  'md.collapseProps': 'Hide properties',
  'md.props': 'Properties',
  'md.empty': '(no content)',
  'md.collapseOutline': 'Hide outline',
  'md.outline': 'Outline',
  'md.openExternallyTitle': "Open with the system's associated editor (usually Obsidian)",
  'md.openInObsidian': 'Open in Obsidian',
  'md.collapseBacklinks': 'Hide backlinks',
  'md.backlinks': 'Backlinks',

  // Read-only file banner
  'readonly.note': 'Read-only (resources are never rewritten)',

  // Center pane
  'center.conversation': 'Conversation',
  'center.close': 'Close',
  'center.read': 'Read',
  'center.source': 'Source',

  // Onboarding
  'onboarding.title': 'Choose the KB directory',
  'onboarding.description': 'yantao stores the knowledge base as plain Markdown files. Pick an empty directory or an existing KB directory; missing structure is created automatically.',
  'onboarding.busy': 'Working…',
  'onboarding.choose': 'Choose directory',

  // Proposal card
  'proposal.highlight': 'Key reminders',
  'proposal.digest': 'Routine notices (digest)',
  'proposal.empty': 'Nothing worth recording in the KB this time.',
  'proposal.acceptAll': 'Accept all',
  'proposal.ignoreAll': 'Ignore all',
  'proposal.confirmWrite': 'Confirm write ({count})',

  // Selection menu
  'selection.title': 'Selected text',
  'selection.send': 'Send to conversation',
  'selection.capability': 'Capabilities',
  'selection.runOnFile': 'Run a capability on the current file',

  // Proposal groups
  'group.createEntity': 'New entities',
  'group.projectUpdate': 'Project updates',
  'group.writeState': 'State writes',
  'group.resource': 'Resources',
  'group.domainLink': 'Domain links',
  'group.todo': 'Todos',
  'group.editSection': 'Section edits',
} satisfies Record<WorkbenchLocaleKey, string>
