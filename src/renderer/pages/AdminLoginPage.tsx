import { MilestoneSkeletonPage } from '@renderer/components/common/MilestoneSkeletonPage'

export function AdminLoginPage() {
  return (
    <MilestoneSkeletonPage
      milestone="M5"
      skeletonTitle="管理员验证尚未启用"
      capability="M5 将实现管理员密码验证、安全会话和管理入口保护。"
      detail="本演示不提供固定密码，不执行真实认证，也不产生已登录或权限状态。"
      returnLabel="返回数据管理演示"
      returnTo="/admin/data"
    />
  )
}
