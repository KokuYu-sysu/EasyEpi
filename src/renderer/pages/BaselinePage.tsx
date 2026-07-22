import { MilestoneSkeletonPage } from '@renderer/components/common/MilestoneSkeletonPage'

export function BaselinePage() {
  return (
    <MilestoneSkeletonPage
      milestone="M5"
      skeletonTitle="基线表将在数据里程碑启用"
      capability="M5 将基于真实记录生成可核对的基线特征统计。"
      detail="当前不读取记录、不计算统计结果，也不导出 Excel、Word 或 PDF。"
      returnLabel="返回数据管理演示"
      returnTo="/admin/data"
    />
  )
}
