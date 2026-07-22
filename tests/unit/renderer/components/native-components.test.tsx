import { createRef } from 'react'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { InputProps, TextareaProps } from '@renderer/components/ui'

import {
  Badge,
  Button,
  EmptyState,
  Input,
  Progress,
  Skeleton,
  Textarea
} from '@renderer/components/ui'

describe('Button', () => {
  it('passes native props, data attributes, clicks, and a safe default button type', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <Button aria-label="保存" data-tracking="save" onClick={onClick}>
        保存
      </Button>
    )

    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('data-tracking', 'save')
    expect(button).toHaveAttribute('type', 'button')
    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('forwards its ref and composes custom, token, and visible-focus classes', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} className="survey-action">
        下一步
      </Button>
    )

    expect(ref.current).toBe(screen.getByRole('button'))
    ref.current?.focus()
    expect(ref.current).toHaveFocus()
    expect(ref.current?.className).toContain('survey-action')
    expect(ref.current?.className).toContain('bg-[var(--color-brand)]')
    expect(ref.current?.className).toContain('focus-visible:')
  })

  it('honors an explicit submit type', () => {
    render(
      <form aria-label="问卷">
        <Button type="submit">提交</Button>
      </form>
    )

    expect(screen.getByRole('button', { name: '提交' })).toHaveAttribute('type', 'submit')
  })

  it('disables loading buttons, prevents clicks and submission, and keeps the supplied name', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())

    render(
      <form aria-label="调查表" onSubmit={onSubmit}>
        <Button loading type="submit" onClick={onClick}>
          保存很长的中文调查问卷
        </Button>
      </form>
    )

    const button = screen.getByRole('button', { name: '保存很长的中文调查问卷' })
    expect(button).toBeDisabled()
    await user.click(button)
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'supports the %s visual variant',
    (variant) => {
      render(<Button variant={variant}>{variant}</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant)
    }
  )

  it.each(['sm', 'md', 'lg'] as const)('supports the %s size', (size) => {
    render(<Button size={size}>{size}</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('data-size', size)
  })
})

describe.each([
  ['Input', Input, 'input'],
  ['Textarea', Textarea, 'textarea']
] as const)('%s', (_name, Field, elementName) => {
  it('renders a native labelled control and passes attributes, data, and refs', () => {
    const ref = createRef<HTMLInputElement & HTMLTextAreaElement>()
    render(
      <Field
        ref={ref}
        label="研究对象编号"
        name="participantId"
        required
        data-source="registry"
        placeholder="例如：P-001"
      />
    )

    const control = screen.getByLabelText('研究对象编号')
    expect(control.tagName.toLowerCase()).toBe(elementName)
    expect(control).toHaveAttribute('name', 'participantId')
    expect(control).toBeRequired()
    expect(control).toHaveAttribute('data-source', 'registry')
    expect(ref.current).toBe(control)
    ref.current?.focus()
    expect(control).toHaveFocus()
    expect(control.className).toContain('focus-visible:')
  })

  it('keeps a generated id stable and composes hint and caller descriptions', () => {
    const { rerender } = render(
      <Field label="年龄" hint="填写周岁" aria-describedby="external-note" />
    )

    const control = screen.getByLabelText('年龄')
    const firstId = control.id
    expect(firstId).toBeTruthy()
    expect(control).toHaveAccessibleDescription('填写周岁')
    expect(control.getAttribute('aria-describedby')).toContain('external-note')

    rerender(<Field label="年龄" hint="填写周岁" aria-describedby="external-note" />)
    expect(screen.getByLabelText('年龄')).toHaveAttribute('id', firstId)
  })

  it('links textual errors and exposes invalid semantics beyond color', () => {
    render(<Field label="年龄" error="请输入有效年龄" defaultValue="abc" />)

    const control = screen.getByLabelText('年龄')
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAccessibleDescription('请输入有效年龄')
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效年龄')
  })

  it('emits exactly one mutually exclusive border color for an error', () => {
    render(<Field label="年龄" error="请输入有效年龄" />)

    const classes = screen.getByLabelText('年龄').className.split(' ')
    expect(classes).toContain('border-[var(--color-border-danger)]')
    expect(classes).not.toContain('border-[var(--color-border-default)]')
  })

  it('treats empty hint and error strings as absent', () => {
    render(<Field label="年龄" hint="" error="" />)

    const control = screen.getByLabelText('年龄')
    expect(control).not.toHaveAttribute('aria-describedby')
    expect(control).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('composes a custom class without dropping token defaults', () => {
    render(<Field label="备注" className="wide-field" />)
    const control = screen.getByLabelText('备注')
    expect(control.className).toContain('wide-field')
    expect(control.className).toContain('border-[var(--color-border-default)]')
  })
})

it('keeps field feedback props constrained to supported text', () => {
  expectTypeOf<InputProps['hint']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<InputProps['error']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<TextareaProps['hint']>().toEqualTypeOf<string | undefined>()
  expectTypeOf<TextareaProps['error']>().toEqualTypeOf<string | undefined>()
})

describe('Badge', () => {
  it.each(['neutral', 'success', 'warning', 'danger', 'info'] as const)(
    'renders the %s semantic visual variant without changing text semantics',
    (variant) => {
      render(<Badge variant={variant}>已同步</Badge>)
      const badge = screen.getByText('已同步')
      expect(badge.tagName).toBe('SPAN')
      expect(badge).toHaveAttribute('data-variant', variant)
    }
  )

  it('passes native span props and composes classes', () => {
    render(
      <Badge className="compact-badge" data-state="ready">
        就绪
      </Badge>
    )
    const badge = screen.getByText('就绪')
    expect(badge).toHaveAttribute('data-state', 'ready')
    expect(badge.className).toContain('compact-badge')
    expect(badge.className).toContain('rounded-[var(--radius-4)]')
  })
})

describe('Progress', () => {
  it('makes its ref/native props the progressbar root while computed values stay authoritative', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Progress
        ref={ref}
        label="上传进度"
        value={2}
        data-job="upload"
        className="upload-progress"
        aria-describedby="upload-note"
        aria-valuenow={999}
      />
    )

    expect(ref.current).toHaveAttribute('role', 'progressbar')
    expect(ref.current).toHaveAttribute('data-job', 'upload')
    expect(ref.current).toHaveAttribute('aria-describedby', 'upload-note')
    expect(ref.current).toHaveAttribute('aria-valuenow', '2')
    expect(ref.current?.className).toContain('gap-[var(--space-2)]')
    expect(ref.current?.className).toContain('upload-progress')
  })

  it('clamps values and exposes visible and programmatic progress information', () => {
    render(<Progress label="导入进度" max={80} value={100} />)

    const progress = screen.getByRole('progressbar', { name: '导入进度' })
    expect(progress).toHaveAttribute('aria-valuemin', '0')
    expect(progress).toHaveAttribute('aria-valuemax', '80')
    expect(progress).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByText('导入进度')).toBeVisible()
    expect(screen.getByText('80 / 80')).toBeVisible()
    expect(progress.lastElementChild?.firstElementChild).toHaveStyle({ width: '100%' })
  })

  it('provides matching custom visible and accessible value text', () => {
    render(
      <Progress
        label="问卷处理进度"
        max={10}
        value={3}
        valueLabel="已完成三份"
        valueText="已完成三份，共十份"
      />
    )

    const progress = screen.getByRole('progressbar', { name: '问卷处理进度' })
    expect(screen.getByText('已完成三份')).toBeVisible()
    expect(progress).toHaveAttribute('aria-valuetext', '已完成三份，共十份')
  })

  it.each([
    { value: Number.NaN, max: 10, safeValue: 0, safeMax: 10, width: '0%' },
    { value: Number.POSITIVE_INFINITY, max: 10, safeValue: 0, safeMax: 10, width: '0%' },
    { value: Number.NEGATIVE_INFINITY, max: 10, safeValue: 0, safeMax: 10, width: '0%' },
    { value: -4, max: 10, safeValue: 0, safeMax: 10, width: '0%' },
    { value: 12, max: 0, safeValue: 1, safeMax: 1, width: '100%' },
    { value: 3, max: Number.NaN, safeValue: 1, safeMax: 1, width: '100%' },
    { value: 3, max: Number.POSITIVE_INFINITY, safeValue: 1, safeMax: 1, width: '100%' },
    { value: 3, max: Number.NEGATIVE_INFINITY, safeValue: 1, safeMax: 1, width: '100%' },
    { value: 3, max: -2, safeValue: 1, safeMax: 1, width: '100%' }
  ])(
    'normalizes value $value and max $max without invalid percentages',
    ({ value, max, safeValue, safeMax, width }) => {
      render(<Progress label="准备数据" max={max} value={value} />)

      const progress = screen.getByRole('progressbar', { name: '准备数据' })
      const fill = progress.lastElementChild?.firstElementChild
      expect(progress).toHaveAttribute('aria-valuemin', '0')
      expect(progress).toHaveAttribute('aria-valuemax', String(safeMax))
      expect(progress).toHaveAttribute('aria-valuenow', String(safeValue))
      expect(fill).toHaveStyle({ width })
      expect(fill?.getAttribute('style')).not.toMatch(/Infinity|NaN/)
    }
  )
})

describe('EmptyState', () => {
  it('forwards section props, its ref, and custom classes', () => {
    const ref = createRef<HTMLElement>()
    render(
      <EmptyState
        ref={ref}
        title="暂无数据"
        description="还没有可显示的数据。"
        data-view="empty"
        className="empty-survey"
      />
    )

    expect(ref.current).toHaveAttribute('data-view', 'empty')
    expect(ref.current?.className).toContain('empty-survey')
    expect(ref.current?.className).toContain('border-[var(--color-border-default)]')
  })

  it('provides heading, description, and native action semantics', () => {
    render(
      <EmptyState
        title="暂无问卷"
        description="创建第一份问卷以开始收集数据。"
        action={<Button>创建问卷</Button>}
      />
    )

    expect(screen.getByRole('heading', { name: '暂无问卷' })).toBeInTheDocument()
    expect(screen.getByText('创建第一份问卷以开始收集数据。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建问卷' })).toBeInTheDocument()
  })

  it('composes caller labelling and supports constrained heading levels', () => {
    render(
      <>
        <span id="empty-context">问卷区域</span>
        <EmptyState
          aria-labelledby="empty-context"
          headingLevel={3}
          title="暂无问卷"
          description="还没有问卷。"
        />
      </>
    )

    const heading = screen.getByRole('heading', { level: 3, name: '暂无问卷' })
    const section = heading.closest('section')
    expect(section?.getAttribute('aria-labelledby')?.split(' ')).toEqual([
      'empty-context',
      heading.id
    ])
  })
})

describe('Skeleton', () => {
  it('hides decoration while exposing adjacent loading status text', () => {
    render(<Skeleton statusText="正在加载问卷列表" data-testid="skeleton" />)

    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('正在加载问卷列表')
    expect(status).toBeVisible()
    expect(status).not.toHaveClass('sr-only')
  })
})
