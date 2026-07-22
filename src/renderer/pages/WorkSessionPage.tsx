import { MilestoneSkeletonPage } from '@renderer/components/common/MilestoneSkeletonPage'

export function WorkSessionPage() {
  return (
    <MilestoneSkeletonPage
      milestone="M4"
      skeletonTitle="工作循环将在录入里程碑启用"
      capability="M4 将提供现场录入、草稿、续录、提交和标准工作循环。"
      detail="当前不会创建调查会话，也不会保留录入进度。"
      returnLabel="返回录入演示"
      returnTo="/entry"
    />
  )
}
