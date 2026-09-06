import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminRouteGuard } from '@renderer/app/AdminRouteGuard'
import { QualityDashboard } from '@renderer/components/admin/QualityDashboard'
import { clearAdminSession } from '@renderer/stores/admin-session.store'
import type { QualitySummary } from '@shared/types/quality'

const populatedSummary: QualitySummary = {
  records: 3,
  completeness: {
    overall: 0.75,
    perQuestion: [
      {
        questionId: 'age',
        variableName: 'age',
        label: '年龄',
        answered: 3,
        applicable: 3,
        rate: 1
      }
    ]
  },
  outliers: [
    {
      recordId: 'r1',
      questionId: 'age',
      variableName: 'age',
      label: '年龄',
      value: 130,
      reason: '超过允许范围'
    },
    {
      recordId: 'r2',
      questionId: 'age-null',
      variableName: 'age_null',
      label: '年龄空值',
      reason: '值缺失'
    }
  ],
  contradictions: [
    {
      recordId: 'r1',
      questionId: 'pregnant',
      variableName: 'pregnant',
      label: '是否怀孕',
      reason: '隐藏题目仍有答案'
    }
  ],
  duplicates: [
    {
      recordId: 'r2',
      duplicateOf: 'r1',
      identicalAnswers: true,
      matchSummary: '身份证号相同'
    },
    {
      recordId: 'r3',
      duplicateOf: 'r1',
      identicalAnswers: false,
      matchSummary: '姓名与生日相同'
    }
  ]
}

const emptySummary: QualitySummary = {
  records: 0,
  completeness: { overall: 0, perQuestion: [] },
  outliers: [],
  contradictions: [],
  duplicates: []
}

function installEasyEpi(value: unknown) {
  Object.defineProperty(window, 'easyEpi', { configurable: true, value })
}

describe('QualityDashboard', () => {
  const onMessage = vi.fn()

  beforeEach(() => onMessage.mockReset())
  afterEach(() => Reflect.deleteProperty(window, 'easyEpi'))

  it('renders all report findings and refreshes into the empty report state', async () => {
    const user = userEvent.setup()
    const getSummary = vi.fn()
      .mockResolvedValueOnce({ ok: true, summary: populatedSummary })
      .mockResolvedValueOnce({ ok: true, summary: emptySummary })
    installEasyEpi({ quality: { getSummary } })

    render(
      <MemoryRouter>
        <QualityDashboard onMessage={onMessage} />
      </MemoryRouter>
    )

    expect(await screen.findByText('75.0%')).toBeVisible()
    expect(screen.getByText(/年龄（age）= 130/)).toHaveTextContent('超过允许范围')
    expect(screen.getByText(/年龄空值（age_null）=/)).toHaveTextContent('值缺失')
    expect(screen.getByText(/是否怀孕（pregnant）/)).toHaveTextContent('隐藏题目仍有答案')
    expect(screen.getByText(/记录 r2 与记录 r1/)).toHaveTextContent('答案完全相同')
    expect(screen.getByText(/记录 r3 与记录 r1/)).not.toHaveTextContent('答案完全相同')

    await user.click(screen.getByRole('button', { name: '刷新报告' }))
    expect(await screen.findByText('当前问卷没有题目。')).toBeVisible()
    expect(screen.getByText('未发现超出题目约束的值。')).toBeVisible()
    expect(screen.getByText('未发现被条件规则隐藏却仍有答案的题目。')).toBeVisible()
    expect(screen.getByText('未发现重复记录。')).toBeVisible()
    expect(getSummary).toHaveBeenCalledTimes(2)
  })

  it('reports ordinary failures and retains the no-data state', async () => {
    installEasyEpi({
      quality: { getSummary: vi.fn().mockResolvedValue({ ok: false, error: 'REPORT_FAILED' }) }
    })

    render(
      <MemoryRouter>
        <QualityDashboard onMessage={onMessage} />
      </MemoryRouter>
    )

    expect(await screen.findByText('暂无数据')).toBeVisible()
    expect(onMessage).toHaveBeenCalledWith('数据质量报告生成失败。')
  })

  it('redirects to login when the admin session has expired', async () => {
    installEasyEpi({
      quality: {
        getSummary: vi.fn().mockRejectedValue(new Error('ADMIN_SESSION_REQUIRED'))
      }
    })

    render(
      <MemoryRouter initialEntries={['/admin/data']}>
        <Routes>
          <Route path="/admin/data" element={<QualityDashboard onMessage={onMessage} />} />
          <Route path="/admin/login" element={<p>管理员登录</p>} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('管理员登录')).toBeVisible()
    expect(onMessage).not.toHaveBeenCalled()
  })
})

describe('AdminRouteGuard', () => {
  beforeEach(() => clearAdminSession())
  afterEach(() => {
    clearAdminSession()
    Reflect.deleteProperty(window, 'easyEpi')
  })

  function renderGuard() {
    return render(
      <MemoryRouter initialEntries={['/admin/data']}>
        <Routes>
          <Route
            path="/admin/data"
            element={
              <AdminRouteGuard>
                <p>受保护内容</p>
              </AdminRouteGuard>
            }
          />
          <Route path="/admin/login" element={<p>管理员登录</p>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('shows a checking state and then renders protected content for a valid session', async () => {
    installEasyEpi({
      admin: {
        checkSession: vi.fn().mockResolvedValue({
          isAuthenticated: true,
          expiresAt: Date.now() + 60_000
        })
      }
    })

    renderGuard()
    expect(screen.getByRole('status')).toHaveTextContent('正在验证管理员会话')
    expect(await screen.findByText('受保护内容')).toBeVisible()
  })

  it('redirects to login when session validation fails', async () => {
    installEasyEpi({
      admin: { checkSession: vi.fn().mockRejectedValue(new Error('SESSION_CHECK_FAILED')) }
    })

    renderGuard()
    expect(await screen.findByText('管理员登录')).toBeVisible()
  })

  it('does not update state after being unmounted during validation', async () => {
    let resolveSession!: (value: { isAuthenticated: boolean }) => void
    const checkSession = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveSession = resolve
    }))
    installEasyEpi({ admin: { checkSession } })

    const view = renderGuard()
    await waitFor(() => expect(checkSession).toHaveBeenCalledOnce())
    view.unmount()
    resolveSession({ isAuthenticated: false })
    await Promise.resolve()
    expect(checkSession).toHaveBeenCalledOnce()
  })
})
