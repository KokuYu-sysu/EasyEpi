import { MilestoneSkeletonPage } from '@renderer/components/common/MilestoneSkeletonPage'

export function DerivedPage() {
  return (
    <MilestoneSkeletonPage
      milestone="M7"
      skeletonTitle="衍生变量将在高级功能里程碑启用"
      capability="M7 将提供公式编辑、依赖检查、历史记录重算和数据质量能力。"
      detail="当前不会执行公式、生成衍生值或修改任何问卷与记录。"
      returnLabel="返回问卷设计演示"
      returnTo="/designer"
    />
  )
}
