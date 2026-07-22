import { MilestoneSkeletonPage } from '@renderer/components/common/MilestoneSkeletonPage'

export function ImportPage() {
  return (
    <MilestoneSkeletonPage
      milestone="M6"
      skeletonTitle="EpiData 兼容能力尚在规划中"
      capability="M6 将提供 EpiData 问卷导入、预览和字段映射修正。"
      detail="在获得真实脱敏样本验证前，产品不会宣称覆盖全部 EpiData 变体。"
    />
  )
}
