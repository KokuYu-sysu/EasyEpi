import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { Button, Select, Label, Modal } from '@renderer/components/ui'

interface BaselineRow {
  variable: string
  label: string
  total?: string
  group1?: string
  group2?: string
  pValue?: number
}

export function BaselinePage() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle<{ title: string; description: string }>()
  const [groupVariable, setGroupVariable] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [tableData, setTableData] = useState<BaselineRow[]>([])

  // 模拟变量列表
  const variables = [
    { value: 'age', label: '年龄' },
    { value: 'sex', label: '性别' },
    { value: 'bmi', label: 'BMI' },
    { value: 'blood_pressure', label: '血压' },
    { value: 'smoking', label: '吸烟状态' }
  ]

  // 模拟分组变量
  const groupVariables = [
    { value: '', label: '不分组' },
    { value: 'treatment', label: '治疗组' },
    { value: 'gender', label: '性别' }
  ]

  const handleGenerate = async () => {
    setIsGenerating(true)
    
    // 模拟生成基线表
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const mockData: BaselineRow[] = [
      {
        variable: 'age',
        label: '年龄 (岁)',
        total: '45.3±12.1',
        group1: '44.8±11.9',
        group2: '45.9±12.3',
        pValue: 0.521
      },
      {
        variable: 'sex',
        label: '性别',
        total: '',
        group1: '',
        group2: '',
        pValue: 0.673
      },
      {
        variable: 'sex_male',
        label: '  男',
        total: '98 (49.0%)',
        group1: '47 (47.0%)',
        group2: '51 (51.0%)'
      },
      {
        variable: 'sex_female',
        label: '  女',
        total: '102 (51.0%)',
        group1: '53 (53.0%)',
        group2: '49 (49.0%)'
      },
      {
        variable: 'bmi',
        label: 'BMI (kg/m²)',
        total: '24.5±3.2',
        group1: '24.3±3.1',
        group2: '24.7±3.3',
        pValue: 0.384
      }
    ]
    
    setTableData(mockData)
    setIsGenerating(false)
  }

  const handleExport = () => {
    // 模拟导出CSV
    const csv = [
      ['Variable', 'Total', 'Group 1', 'Group 2', 'P value'],
      ...tableData.map(row => [
        row.label,
        row.total || '',
        row.group1 || '',
        row.group2 || '',
        row.pValue?.toString() || ''
      ])
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'baseline_table.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description}
      demoMessage="M5 基线表功能已启用，可生成基线特征统计表。"
    >
      <h2 className="m-0 text-[length:var(--font-size-xl)]">基线表生成</h2>
      
      <div className="space-y-6">
        {/* 控制面板 */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold mb-4">基线表生成</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>分组变量</Label>
              <Select
                value={groupVariable}
                onValueChange={setGroupVariable}
                options={groupVariables}
              />
            </div>
            
            <div className="flex items-end gap-2">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? '生成中...' : '生成基线表'}
              </Button>
              
              {tableData.length > 0 && (
                <Button variant="outline" onClick={handleExport}>
                  导出CSV
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 基线表预览 */}
        {tableData.length > 0 && (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold">Table 1. Baseline Characteristics</h3>
              <p className="text-sm text-muted-foreground">
                {groupVariable ? `按 ${groupVariables.find(g => g.value === groupVariable)?.label} 分组` : '总体统计'}
              </p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-3 text-left font-medium">Variable</th>
                    <th className="p-3 text-center font-medium">
                      Total (n=200)
                    </th>
                    {groupVariable && (
                      <>
                        <th className="p-3 text-center font-medium">Group 1 (n=100)</th>
                        <th className="p-3 text-center font-medium">Group 2 (n=100)</th>
                        <th className="p-3 text-center font-medium">P value</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, index) => (
                    <tr
                      key={row.variable}
                      className={index % 2 === 0 ? 'bg-background' : 'bg-muted/50'}
                    >
                      <td className="p-3">
                        {row.label}
                      </td>
                      <td className="p-3 text-center">{row.total}</td>
                      {groupVariable && (
                        <>
                          <td className="p-3 text-center">{row.group1}</td>
                          <td className="p-3 text-center">{row.group2}</td>
                          <td className="p-3 text-center">
                            {row.pValue !== undefined ? row.pValue.toFixed(3) : ''}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 空状态 */}
        {tableData.length === 0 && !isGenerating && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg">选择分组变量后点击"生成基线表"</p>
            <p className="text-sm mt-2">系统将自动计算各变量的统计描述</p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
          <Modal
            trigger={<Button>了解后续能力</Button>}
            title="M5 后续能力说明"
            description="基线表功能尚未完全实现。"
          >
            <p className="text-[var(--color-text-secondary)]">
              M5 将实现完整的基线表生成功能，包括变量分类、统计检验、分组统计等。当前页面仅用于确认信息结构和安全返回路径。
            </p>
          </Modal>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-1)] border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-[var(--space-4)] py-[var(--space-2)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]"
            to="/admin/dashboard"
          >
            返回数据管理
          </Link>
        </div>
      </div>
    </MilestonePage>
  )
}