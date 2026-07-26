import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { Button, Input, Label, Modal } from '@renderer/components/ui'

export function AdminLoginPage() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle<{ title: string; description: string }>()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [isLocked, setIsLocked] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (isLocked) {
      setError('账户已锁定，请5分钟后再试')
      return
    }

    if (!password.trim()) {
      setError('请输入密码')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.easyEpi.admin.login({ password })
      
      if (result.success) {
        navigate('/admin/dashboard')
      } else {
        const newAttempts = attempts + 1
        setAttempts(newAttempts)
        
        if (newAttempts >= 5) {
          setIsLocked(true)
          setError('密码错误次数过多，账户已锁定5分钟')
          setTimeout(() => {
            setIsLocked(false)
            setAttempts(0)
          }, 5 * 60 * 1000)
        } else {
          setError(`密码错误，还剩${5 - newAttempts}次尝试机会`)
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description}
      demoMessage="M5 管理员验证功能已启用，可使用默认密码 admin123 登录。"
    >
      <h2 className="m-0 text-[length:var(--font-size-xl)]">管理员验证</h2>
      
      <div className="max-w-md mx-auto">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm text-muted-foreground mb-6">
            请输入管理员密码以访问数据管理后台
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入管理员密码"
                disabled={isLoading || isLocked}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || isLocked}
            >
              {isLoading ? '验证中...' : '登录'}
            </Button>
          </form>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
        <Modal
          trigger={<Button>了解后续能力</Button>}
          title="M5 后续能力说明"
          description="管理员验证功能尚未完全实现。"
        >
          <p className="text-[var(--color-text-secondary)]">
            M5 将实现完整的管理员验证功能，包括密码保护、会话管理、账户锁定等。当前页面仅用于确认信息结构和安全返回路径。
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