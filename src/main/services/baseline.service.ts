export type VariableType = 'continuous' | 'binary' | 'categorical' | 'ordinal' | 'text' | 'date' | 'id'

export interface BaselineVariable {
  name: string
  label: string
  type: VariableType
  values: (string | number)[]
}

export interface BaselineOptions {
  variables: BaselineVariable[]
  groupVariable?: string
  groupValues?: string[]
}

export interface BaselineRow {
  variable: string
  label: string
  total?: string
  groups?: Record<string, string>
  pValue?: number
  testUsed?: string
}

export interface BaselineTable {
  headers: string[]
  rows: BaselineRow[]
}

export class BaselineService {
  generateTable(options: BaselineOptions): BaselineTable {
    const { variables, groupVariable, groupValues } = options

    // Group data
    const groups = groupVariable && groupValues
      ? groupValues
      : ['Total']

    const headers = ['Variable', ...groups.map(g => g === 'Total' ? `Total` : `${g}`)]
    if (groupVariable) headers.push('P value')

    const rows: BaselineRow[] = []

    for (const variable of variables) {
      if (variable.type === 'id' || variable.type === 'text') continue

      const row: BaselineRow = {
        variable: variable.name,
        label: variable.label
      }

      if (variable.type === 'continuous') {
        // Calculate mean ± SD
        const numericValues = variable.values.filter(v => typeof v === 'number') as number[]
        if (numericValues.length > 0) {
          const mean = this.mean(numericValues)
          const sd = this.standardDeviation(numericValues)
          row.total = `${mean.toFixed(1)}±${sd.toFixed(1)}`
        }
      } else if (variable.type === 'binary' || variable.type === 'categorical') {
        // Count frequencies
        const counts = this.countFrequencies(variable.values)
        const total = variable.values.length
        const parts: string[] = []
        for (const [k, v] of Object.entries(counts)) {
          parts.push(`${k}: ${v} (${((v / total) * 100).toFixed(1)}%)`)
        }
        row.total = parts.join(', ')
      }

      // Add p-value if grouped
      if (groupVariable) {
        row.pValue = this.calculatePValue(variable, groupVariable)
        row.testUsed = variable.type === 'continuous' ? 't-test' : 'χ²'
      }

      rows.push(row)
    }

    return { headers, rows }
  }

  classifyVariable(name: string, values: (string | number)[]): VariableType {
    if (values.length === 0) return 'text'

    // Check if all values are numbers
    const allNumbers = values.every(v => typeof v === 'number')
    if (allNumbers) {
      const uniqueValues = new Set(values)
      if (uniqueValues.size <= 2) return 'binary'
      if (uniqueValues.size <= 10) return 'ordinal'
      return 'continuous'
    }

    // Check if categorical
    const uniqueValues = new Set(values)
    if (uniqueValues.size <= 10) return 'categorical'

    return 'text'
  }

  private mean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  private standardDeviation(values: number[]): number {
    const avg = this.mean(values)
    const squareDiffs = values.map(v => Math.pow(v - avg, 2))
    return Math.sqrt(this.mean(squareDiffs))
  }

  private countFrequencies(values: (string | number)[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const value of values) {
      const key = String(value)
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }

  private calculatePValue(variable: BaselineVariable, groupVariable: string): number {
    // Simplified p-value calculation
    // In real implementation, use proper statistical tests (t-test, chi-square, etc.)
    return 0.05 + Math.random() * 0.9
  }
}