import { Link } from 'react-router-dom'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { Badge, Button, Modal } from '@renderer/components/ui'

const primaryLinkClasses =
  'inline-flex min-h-12 items-center justify-center rounded-[var(--radius-1)] bg-[var(--color-brand)] px-[var(--space-5)] py-[var(--space-3)] font-[var(--font-weight-semibold)] text-[var(--color-on-brand)]'
const secondaryLinkClasses =
  'inline-flex min-h-12 items-center justify-center rounded-[var(--radius-1)] border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-[var(--space-5)] py-[var(--space-3)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]'

function ProjectExplanation({ action }: { action: '新建项目' | '打开项目' }) {
  return (
    <Modal
      trigger={<Button variant="secondary">{action}</Button>}
      title={`${action}将在 M3 实现`}
      description="EasyEpi M2 只提供可交互界面骨架。"
    >
      <p className="text-[var(--color-text-secondary)]">
        当前操作不会创建或保存真实项目，也不会读取文件或浏览器存储。M3 将提供加密项目文件、问卷模型和可靠的打开与保存流程。
      </p>
    </Modal>
  )
}

export function WelcomePage() {
  const handle = useCurrentRouteHandle()
  if (handle === null) {
    throw new Error('WELCOME_ROUTE_METADATA_MISSING')
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '离线开展问卷设计、现场录入和调查数据管理。'}
      demoMessage="离线演示：除界面偏好外，本页不会写入文件或浏览器存储。"
      actions={
        <>
          <ProjectExplanation action="新建项目" />
          <ProjectExplanation action="打开项目" />
        </>
      }
    >
      <section className="grid gap-[var(--space-5)] rounded-[var(--radius-3)] bg-[var(--color-surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-z1)]">
        <div className="grid gap-[var(--space-3)]">
          <Badge className="w-fit" variant="info">本地离线工作</Badge>
          <h2 className="m-0 text-[length:var(--font-size-xl)]">为现场调查和问卷信息收集而设计</h2>
          <p className="m-0 max-w-[70ch] text-[var(--color-text-secondary)]">
            EasyEpi 面向流行病学研究团队，在 Windows 电脑上离线组织问卷、开展单题录入并管理调查数据。当前 M2 展示的是不保存业务数据的合成交互骨架。
          </p>
        </div>
        <nav aria-label="欢迎页主要操作" className="flex flex-wrap gap-[var(--space-3)]">
          <Link className={primaryLinkClasses} to="/designer">开始问卷设计</Link>
          <Link className={secondaryLinkClasses} to="/entry">进入录入演示</Link>
          <Link className={secondaryLinkClasses} to="/admin/data">查看数据管理演示</Link>
        </nav>
      </section>

      <section aria-labelledby="recent-projects-title" className="grid gap-[var(--space-3)]">
        <div>
          <h2 id="recent-projects-title" className="m-0 text-[length:var(--font-size-xl)]">最近项目</h2>
          <p className="mb-0 mt-[var(--space-1)] text-[var(--color-text-secondary)]">以下内容是合成演示，不代表磁盘中存在项目文件。</p>
        </div>
        <article className="grid gap-[var(--space-3)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-4)]">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <h3 className="m-0 text-[length:var(--font-size-lg)]">社区健康调查（合成演示）</h3>
            <Badge variant="warning">演示</Badge>
          </div>
          <p className="m-0 text-[var(--color-text-secondary)]">12 道合成题目 · 最后演示于今天 · 重启后重置</p>
          <Link className={`${secondaryLinkClasses} w-fit`} to="/designer">继续合成演示项目</Link>
        </article>
      </section>
    </MilestonePage>
  )
}
