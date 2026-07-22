import { useState } from 'react'

import { DemoBanner } from '@renderer/components/common/DemoBanner'
import { PageHeader } from '@renderer/components/common/PageHeader'
import {
  Badge, Button, Checkbox, ConfirmDialog, EmptyState, Input, Modal,
  Progress, Radio, Select, Skeleton, Textarea, Tooltip, useToast,
  type ToastTone
} from '@renderer/components/ui'

const longText = '这是一段用于验证换行、字号与窄窗口布局的很长中文调查说明，现场调查员必须能够完整阅读内容且所有操作仍然可达。'

function GallerySection({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <section className="grid gap-[var(--space-3)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-4)]">
      <h2 className="m-0 text-[length:var(--font-size-xl)]">{title}</h2>
      {children}
    </section>
  )
}

export function ComponentGalleryPage() {
  const toast = useToast()
  const [choice, setChoice] = useState('one')
  const [checked, setChecked] = useState(true)
  const pushTone = (tone: ToastTone) => toast.push({ title: `${tone} 通知`, description: longText, tone })

  return (
    <div className="grid gap-[var(--space-5)] pb-[var(--space-10)]">
      <div className="sticky top-0 z-[var(--z-2)]">
        <DemoBanner>仅开发环境：组件状态均为合成本地演示，不会写入问卷数据。</DemoBanner>
      </div>
      <PageHeader title="设计系统组件展厅" description="集中检查十四个基础组件、视觉变体、交互状态、长中文和主题字号组合。" />
      <GallerySection title="主题与字号组合">
        <div className="grid gap-[var(--space-3)] md:grid-cols-2">
          {(['light-normal', 'light-large', 'dark-normal', 'dark-large'] as const).map((combination) => {
            const [theme, scale] = combination.split('-') as ['light' | 'dark', 'normal' | 'large']
            return (
              <article key={combination} data-theme={theme} data-font-scale={scale} className="rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] p-[var(--space-4)] text-[var(--color-text-primary)]">
                <strong>{theme === 'light' ? '浅色' : '深色'} × {scale === 'large' ? '大字' : '标准字号'}</strong>
                <p>{longText}</p><Button size="sm">示例操作</Button>
              </article>
            )
          })}
        </div>
      </GallerySection>
      <GallerySection title="Button 按钮">
        <div className="flex flex-wrap gap-[var(--space-2)]">
          {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => <Button key={variant} variant={variant}>{variant}</Button>)}
          {(['sm', 'md', 'lg'] as const).map((size) => <Button key={size} size={size} variant="secondary">{size}</Button>)}
          <Button disabled>禁用</Button><Button loading>正在加载很长的中文操作</Button>
        </div>
      </GallerySection>
      <GallerySection title="Input 与 Textarea 输入">
        <div className="grid gap-[var(--space-3)] lg:grid-cols-2">
          <Input label="调查对象编号" hint="普通提示状态" placeholder="例如 P-001" />
          <Input label="错误输入" error="编号格式不正确，请检查后重试" defaultValue="错误值" />
          <Input label="禁用输入" disabled defaultValue="不可编辑" />
          <Textarea label="现场备注" hint={longText} defaultValue={longText} />
          <Textarea label="错误备注" error="备注内容需要进一步确认" defaultValue="待确认" />
        </div>
      </GallerySection>
      <GallerySection title="Select、Checkbox 与 Radio 表单选择">
        <div className="grid gap-[var(--space-4)] lg:grid-cols-3">
          <div className="grid gap-[var(--space-3)]">
            <Select label="问卷类型" defaultValue="baseline" options={[{ value: 'baseline', label: '基线调查' }, { value: 'follow', label: '随访调查' }, { value: 'disabled', label: '禁用选项', disabled: true }]} />
            <Select label="禁用选择器" disabled options={[{ value: 'none', label: '不可选择' }]} />
          </div>
          <div className="grid content-start gap-[var(--space-3)]"><Checkbox label="已获得知情确认" checked={checked} onCheckedChange={(value) => setChecked(value === true)} /><Checkbox label="禁用复选项" disabled /></div>
          <Radio label="记录状态" value={choice} onValueChange={setChoice} options={[{ value: 'one', label: '待复核' }, { value: 'two', label: '已复核' }, { value: 'three', label: '禁用状态', disabled: true }]} />
        </div>
      </GallerySection>
      <GallerySection title="Modal 与 ConfirmDialog 浮层">
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <Modal trigger={<Button>打开模态框</Button>} title="编辑演示问卷" description="此操作只改变展厅内存状态。"><p>{longText}</p></Modal>
          <ConfirmDialog trigger={<Button variant="danger">打开危险确认</Button>} title="删除演示项目？" description="这只是确认对话框演示，不会删除任何文件。" confirmLabel="确认删除" cancelLabel="取消" onConfirm={() => pushTone('warning')} />
        </div>
      </GallerySection>
      <GallerySection title="Toast 通知">
        <div className="flex flex-wrap gap-[var(--space-2)]">{(['info', 'success', 'warning', 'danger'] as const).map((tone) => <Button key={tone} aria-label={`显示${tone}通知`} variant="secondary" onClick={() => pushTone(tone)}>{tone}</Button>)}</div>
      </GallerySection>
      <GallerySection title="Progress 进度"><Progress label="问卷完成进度" value={42} max={100} /><Progress label="已完成" value={10} max={10} valueLabel="全部完成" /></GallerySection>
      <GallerySection title="EmptyState 空状态与 Skeleton 骨架">
        <div className="grid gap-[var(--space-4)] lg:grid-cols-2"><EmptyState title="暂时没有问卷" description={longText} action={<Button>创建演示问卷</Button>} /><Skeleton className="h-28" statusText="正在加载演示问卷列表" /></div>
      </GallerySection>
      <GallerySection title="Badge 徽标与 Tooltip 提示">
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">{(['neutral', 'success', 'warning', 'danger', 'info'] as const).map((variant) => <Badge key={variant} variant={variant}>{variant} 状态</Badge>)}<Tooltip content="键盘聚焦和鼠标悬停均可查看此非必要补充说明"><Button variant="ghost">聚焦查看提示</Button></Tooltip></div>
      </GallerySection>
    </div>
  )
}
