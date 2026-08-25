import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { Button, Input } from '@renderer/components/ui'
import { clearAdminSession, syncAdminSession } from '@renderer/stores/admin-session.store'

function loginErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'PROJECT_NOT_UNLOCKED':
      return '请先在欢迎页创建或打开并解锁一个项目。'
    case 'INVALID_ADMIN_PASSWORD':
      return '项目密码不正确。'
    case 'ADMIN_LOGIN_LOCKED':
      return '密码错误次数过多，管理员登录已暂时锁定。'
    default:
      return '管理员验证失败，请重试。'
  }
}

export function AdminLoginPage() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  if (handle === null) throw new Error('ADMIN_LOGIN_ROUTE_METADATA_MISSING')

  useEffect(() => {
    let active = true
    void syncAdminSession().then((authenticated) => {
      if (active && authenticated) navigate('/admin/data', { replace: true })
    }).catch(() => undefined)
    return () => { active = false }
  }, [navigate])

  useEffect(() => {
    if (lockoutUntil === null) return
    const timer = window.setInterval(() => {
      if (Date.now() >= lockoutUntil) {
        setLockoutUntil(null)
        setError(null)
      }
      setCurrentTime(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [lockoutUntil])

  const remainingSeconds = lockoutUntil === null
    ? 0
    : Math.max(0, Math.ceil((lockoutUntil - currentTime) / 1000))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length === 0) {
      setError('请输入当前项目密码。')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.easyEpi.admin.login({ password })
      if (result.success) {
        setPassword('')
        clearAdminSession()
        if (await syncAdminSession()) {
          navigate('/admin/data', { replace: true })
        } else {
          setError('管理员会话状态同步失败，请重试。')
        }
        return
      }
      if (result.lockoutUntil !== undefined) setLockoutUntil(result.lockoutUntil)
      setError(loginErrorMessage(result.error))
    } catch {
      setError('无法完成管理员验证，请检查项目状态后重试。')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '使用当前项目密码进入数据管理后台。'}
    >
      <section className="mx-auto grid w-full max-w-md gap-[var(--space-4)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] p-[var(--space-5)]">
        <h2 className="m-0 text-[length:var(--font-size-xl)]">管理员验证</h2>
        <p className="m-0 text-[var(--color-text-secondary)]">
          管理后台使用当前已打开项目的密码。密码只会发送到本机主进程验证。
        </p>
        <form className="grid gap-[var(--space-4)]" onSubmit={submit}>
          <Input
            id="admin-password"
            label="当前项目密码"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isLoading || remainingSeconds > 0}
            error={error ?? undefined}
          />
          {remainingSeconds > 0 ? (
            <p className="m-0" role="status" aria-live="polite">
              请在 {remainingSeconds} 秒后重试。
            </p>
          ) : null}
          <Button type="submit" loading={isLoading} disabled={remainingSeconds > 0}>
            登录管理后台
          </Button>
        </form>
        <Link
          className="text-[var(--color-text-link)]"
          to="/"
        >
          返回欢迎页
        </Link>
      </section>
    </MilestonePage>
  )
}
