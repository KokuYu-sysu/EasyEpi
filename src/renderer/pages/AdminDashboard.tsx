import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@renderer/components/ui'
import { DataTable } from '@renderer/components/admin/DataTable'
import { ExportDialog } from '@renderer/components/admin/ExportDialog'

export function AdminDashboard() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle<{ title: string; description: string }>()
  const [activeTab, setActiveTab] = useState('data')

  const handleLogout = () => {
    navigate('/admin/login')
  }

  const handleExport = (options: { encoding: string; dummyReference?: string }) => {
    console.log('Export options:', options)
    // TODO: Call export service
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description}
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">数据管理</h2>
        <Button variant="outline" onClick={handleLogout}>
          退出登录
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="data">数据表格</TabsTrigger>
          <TabsTrigger value="baseline">基线表</TabsTrigger>
          <TabsTrigger value="export">导出CSV</TabsTrigger>
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>

        <TabsContent value="data">
          <DataTable
            columns={[
              { key: 'id', label: 'ID' },
              { key: 'createdAt', label: '创建时间' },
              { key: 'updatedAt', label: '更新时间' }
            ]}
            data={[]}
            total={0}
            page={1}
            pageSize={50}
            onPageChange={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onSearch={() => {}}
          />
        </TabsContent>

        <TabsContent value="baseline">
          <div className="text-center py-8 text-muted-foreground">
            基线表功能开发中...
          </div>
        </TabsContent>

        <TabsContent value="export">
          <div className="flex flex-col items-center py-8 space-y-4">
            <p className="text-muted-foreground">
              导出数据为CSV格式，支持多种多选题编码方式
            </p>
            <ExportDialog onExport={handleExport} />
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div className="space-y-4 py-4">
            <h3 className="text-lg font-semibold">管理员设置</h3>
            <div className="space-y-2">
              <Button variant="outline">
                修改密码
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </MilestonePage>
  )
}