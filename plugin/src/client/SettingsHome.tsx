import type { Room } from '../types.ts'
import css from './Panel.module.css'

export function settingsSections(english: boolean) {
  const l = (zh: string, en: string) => english ? en : zh
  return [
    { id: 'memories', title: l('记忆', 'Memory'), description: l('查看、确认或修改 Bot 记住的事情。', 'Review and edit what your Bots remember.') },
    { id: 'policy', title: l('模型', 'Model'), description: l('选择哪个 Bot 使用哪个模型。', 'Choose a model for each Bot.') },
    { id: 'schedules', title: l('定时任务', 'Schedules'), description: l('让 Bot 在指定时间帮你做事。', 'Ask a Bot to do something at a set time.'), needsRoom: true },
    { id: 'history', title: l('聊天记录', 'Chat history'), description: l('查找旧消息，或下载聊天记录。', 'Find older messages or download a conversation.'), needsRoom: true },
    { id: 'budget', title: l('用量限额', 'Usage limits'), description: l('限制全部 Bot 或单个 Bot 的消耗。', 'Set usage limits for all Bots or just one.'), advanced: true },
    { id: 'access', title: l('工具与账号', 'Tools & accounts'), description: l('连接浏览器、外部工具，管理访问密钥。', 'Connect browsers and tools, and manage access keys.'), advanced: true },
    { id: 'team', title: l('团队管理', 'Team management'), description: l('指定一个 Bot 帮你创建和管理团队。', 'Let one Bot help you organize your team.'), advanced: true },
    { id: 'failures', title: l('消息发送问题', 'Delivery issues'), description: l('查看飞书、如流中未成功处理的消息。', 'Review messages that failed in Feishu or InfoFlow.'), advanced: true },
    { id: 'lifecycle', title: l('归档与删除', 'Archive & delete'), description: l('收起暂时不用的聊天，或清理 Bot。', 'Put inactive chats away or remove Bots.'), advanced: true },
  ]
}

export function SettingsHome({ english, room, open, more, setMore }: {
  english: boolean; room: Room | undefined; open(id: string): void; more: boolean; setMore(value: boolean): void
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const cards = (advanced: boolean) => <div className={css.settingsGrid}>
    {settingsSections(english).filter(item => !!item.advanced === advanced).map(item => <button type="button" key={item.id}
      className={css.settingsCard} disabled={item.needsRoom && !room} onClick={() => open(item.id)}
      aria-labelledby={`setting-${item.id}`} aria-describedby={`setting-${item.id}-hint`}>
      <span><strong id={`setting-${item.id}`}>{item.title}</strong><small id={`setting-${item.id}-hint`}>
        {item.needsRoom && !room ? l('先打开一个聊天，再来这里设置。', 'Open a chat to use this setting.') : item.description}
      </small></span><span aria-hidden="true" className={css.settingsArrow}>›</span>
    </button>)}
  </div>
  return <>
    {cards(false)}
    {room && <p className={css.settingsContext}>{l('聊天记录和定时任务用于：', 'History and schedules apply to: ')}<strong>{room.title}</strong></p>}
    <details className={css.settingsMore} open={more} onToggle={event => setMore(event.currentTarget.open)}>
      <summary>{l('更多设置', 'More settings')}<span>{l('用量限额、工具与账号、团队管理等', 'Usage limits, tools, team management and more')}</span></summary>
      {cards(true)}
    </details>
  </>
}
