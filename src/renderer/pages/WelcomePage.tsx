import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { Button, Input, Modal, useToast } from '@renderer/components/ui'
import { clearAdminSession, syncAdminSession } from '@renderer/stores/admin-session.store'

const primaryLinkClasses =
  'inline-flex min-h-12 items-center justify-center rounded-[var(--radius-1)] bg-[var(--color-brand)] px-[var(--space-5)] py-[var(--space-3)] font-[var(--font-weight-semibold)] text-[var(--color-on-brand)]'
const secondaryLinkClasses =
  'inline-flex min-h-12 items-center justify-center rounded-[var(--radius-1)] border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-[var(--space-5)] py-[var(--space-3)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]'

function NewProjectDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isCreating, setIsCreating] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const resetForm = () => {
    setName('')
    setFolderPath('')
    setPassword('')
    setConfirmPassword('')
    setErrors({})
    setIsCreating(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) resetForm()
  }

  const selectFolder = async () => {
    const result = await window.easyEpi.dialog.selectFolder()
    if (!result.canceled && result.filePaths[0]) {
      setFolderPath(result.filePaths[0])
      if (errors.folder) setErrors((e) => ({ ...e, folder: '' }))
    }
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = '请输入项目名称'
    if (!folderPath) newErrors.folder = '请选择存储位置'
    if (!password) newErrors.password = '请设置密码'
    else if (password.length < 6) newErrors.password = '密码至少 6 位'
    if (password !== confirmPassword) newErrors.confirmPassword = '两次密码不一致'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setIsCreating(true)
    clearAdminSession()
    try {
      const result = await window.easyEpi.project.create({
        name: name.trim(),
        folderPath,
        password
      })
      if (result.ok) {
        toast.push({ title: '项目创建成功', tone: 'success' })
        setOpen(false)
        navigate('/designer')
      } else {
        setErrors({ submit: result.error ?? '创建失败' })
      }
    } catch (err) {
      setErrors({ submit: (err as Error).message })
    } finally {
      await syncAdminSession()
      setIsCreating(false)
    }
  }

  return (
    <Modal
      trigger={<Button>新建项目</Button>}
      title="新建项目"
      description="创建一个新的问卷调查项目。"
      open={open}
      onOpenChange={handleOpenChange}
    >
      <form className="mt-[var(--space-4)] grid gap-[var(--space-4)]" onSubmit={handleSubmit}>
        <Input
          label="项目名称 *"
          value={name}
          error={errors.name}
          placeholder="例如：社区健康调查"
          onChange={(e) => {
            setName(e.target.value)
            if (errors.name) setErrors((err) => ({ ...err, name: '' }))
          }}
        />

        <div className="grid gap-[var(--space-1)]">
          <Input
            label="存储位置 *"
            value={folderPath}
            error={errors.folder}
            readOnly
            placeholder="点击右侧按钮选择文件夹"
          />
          <Button type="button" variant="secondary" size="sm" onClick={selectFolder}>
            选择文件夹
          </Button>
        </div>

        <Input
          label="管理员密码 *"
          type="password"
          value={password}
          error={errors.password}
          placeholder="至少 6 位"
          onChange={(e) => {
            setPassword(e.target.value)
            if (errors.password) setErrors((err) => ({ ...err, password: '' }))
          }}
        />

        <Input
          label="确认密码 *"
          type="password"
          value={confirmPassword}
          error={errors.confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value)
            if (errors.confirmPassword) setErrors((err) => ({ ...err, confirmPassword: '' }))
          }}
        />

        {errors.submit && (
          <p className="text-[length:var(--font-size-sm)] text-[var(--color-danger)]">{errors.submit}</p>
        )}

        <div className="flex flex-wrap justify-end gap-[var(--space-3)]">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="submit" disabled={isCreating}>
            {isCreating ? '创建中...' : '创建项目'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function OpenProjectDialog() {
  const [open, setOpen] = useState(false)
  const [filePath, setFilePath] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isOpening, setIsOpening] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const resetForm = () => {
    setFilePath('')
    setPassword('')
    setErrors({})
    setIsOpening(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) resetForm()
  }

  const selectFile = async () => {
    const result = await window.easyEpi.dialog.selectFile([
      { name: 'EasyEpi 项目文件', extensions: ['easyepi'] }
    ])
    if (!result.canceled && result.filePaths[0]) {
      setFilePath(result.filePaths[0])
      if (errors.file) setErrors((e) => ({ ...e, file: '' }))
    }
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!filePath) newErrors.file = '请选择项目文件'
    if (!password) newErrors.password = '请输入密码'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setIsOpening(true)
    clearAdminSession()
    try {
      const result = await window.easyEpi.project.open({ filePath, password })
      if (result.ok) {
        toast.push({ title: '项目打开成功', tone: 'success' })
        setOpen(false)
        navigate('/designer')
      } else {
        setErrors({ submit: result.error ?? '打开失败' })
      }
    } catch (err) {
      setErrors({ submit: (err as Error).message })
    } finally {
      await syncAdminSession()
      setIsOpening(false)
    }
  }

  return (
    <Modal
      trigger={<Button variant="secondary">打开项目</Button>}
      title="打开项目"
      description="打开已有的 EasyEpi 项目文件。"
      open={open}
      onOpenChange={handleOpenChange}
    >
      <form className="mt-[var(--space-4)] grid gap-[var(--space-4)]" onSubmit={handleSubmit}>
        <div className="grid gap-[var(--space-1)]">
          <Input
            label="项目文件 *"
            value={filePath}
            error={errors.file}
            readOnly
            placeholder="点击右侧按钮选择 .easyepi 文件"
          />
          <Button type="button" variant="secondary" size="sm" onClick={selectFile}>
            选择文件
          </Button>
        </div>

        <Input
          label="管理员密码 *"
          type="password"
          value={password}
          error={errors.password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (errors.password) setErrors((err) => ({ ...err, password: '' }))
          }}
        />

        {errors.submit && (
          <p className="text-[length:var(--font-size-sm)] text-[var(--color-danger)]">{errors.submit}</p>
        )}

        <div className="flex flex-wrap justify-end gap-[var(--space-3)]">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="submit" disabled={isOpening}>
            {isOpening ? '打开中...' : '打开项目'}
          </Button>
        </div>
      </form>
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
      description={handle.description ?? '选择右方新建项目或者打开已有项目进行'}
      actions={
        <>
          <NewProjectDialog />
          <OpenProjectDialog />
        </>
      }
    >
      <section className="grid gap-[var(--space-5)] rounded-[var(--radius-3)] bg-[var(--color-surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-z1)]">
        <div className="grid gap-[var(--space-3)]">
          <h2 className="m-0 text-[length:var(--font-size-xl)]">EasyEpi 为一款集合问卷设计、问卷调查、结果统计的桌面端应用</h2>
          <p className="m-0 max-w-[70ch] text-[var(--color-text-secondary)]">
            面向高校、企业或科研机构，于人群中进行社会调查或者流行病学研究。
          </p>
        </div>
        <nav aria-label="欢迎页主要操作" className="flex flex-wrap gap-[var(--space-3)]">
          <Link className={primaryLinkClasses} to="/designer">开始问卷设计</Link>
          <Link className={secondaryLinkClasses} to="/entry">进入录入</Link>
          <Link className={secondaryLinkClasses} to="/admin/data">数据管理</Link>
        </nav>
      </section>

      <section aria-labelledby="recent-projects-title" className="grid gap-[var(--space-3)]">
        <div>
          <h2 id="recent-projects-title" className="m-0 text-[length:var(--font-size-xl)]">最近项目</h2>
          <p className="mb-0 mt-[var(--space-1)] text-[var(--color-text-secondary)]">创建或打开项目后，最近访问的项目将显示在此处。</p>
        </div>
        <article className="grid gap-[var(--space-3)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-4)]">
          <p className="m-0 text-[var(--color-text-secondary)]">暂无最近项目。请使用上方按钮创建或打开项目。</p>
        </article>
      </section>
    </MilestonePage>
  )
}
