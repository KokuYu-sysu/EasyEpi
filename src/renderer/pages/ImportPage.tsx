import { Link, useNavigate } from 'react-router-dom'
import { ImportWizard } from '@renderer/components/import/ImportWizard'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { Button, Modal } from '@renderer/components/ui'

export function ImportPage() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle<{ title: string; description: string }>()

  const handleComplete = (projectPath: string) => {
    // Navigate to the project
    navigate(`/project/${encodeURIComponent(projectPath)}`)
  }

  const handleCancel = () => {
    navigate(-1)
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description}
      demoMessage="导入向导正在开发中，当前为演示界面。完整能力将在 M6 实现。"
    >
      <h2 className="m-0 text-[length:var(--font-size-xl)]">导入向导</h2>
      <ImportWizard onComplete={handleComplete} onCancel={handleCancel} />
      <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
        <Modal
          trigger={<Button>了解后续能力</Button>}
          title="M6 后续能力说明"
          description="EpiData 导入功能尚未实现。"
        >
          <p className="text-[var(--color-text-secondary)]">
            M6 将实现完整的 EpiData 兼容层，包括 .qes 和 .rec 文件解析、导入向导、编码自动检测等功能。当前页面仅用于确认信息结构和安全返回路径，不会保存、导入、认证或修改任何真实数据。
          </p>
        </Modal>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-1)] border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-[var(--space-4)] py-[var(--space-2)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]"
          to="/"
        >
          返回欢迎页
        </Link>
      </div>
    </MilestonePage>
  )
}