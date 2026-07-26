import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataService } from '@main/services/data.service'

describe('DataService', () => {
  let service: DataService

  beforeEach(() => {
    service = new DataService()
  })

  describe('getRecords', () => {
    it('should return paginated result structure', async () => {
      const result = await service.getRecords({ page: 1, pageSize: 50 })
      expect(result).toHaveProperty('records')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('pageSize')
      expect(result).toHaveProperty('totalPages')
    })

    it('should return correct page number', async () => {
      const result = await service.getRecords({ page: 2, pageSize: 50 })
      expect(result.page).toBe(2)
      expect(result.pageSize).toBe(50)
    })
  })

  describe('updateRecord', () => {
    it('should update record without error', async () => {
      await expect(
        service.updateRecord('test-id', { field1: 'value1' })
      ).resolves.not.toThrow()
    })
  })

  describe('deleteRecords', () => {
    it('should delete records without error', async () => {
      await expect(
        service.deleteRecords(['id1', 'id2'])
      ).resolves.not.toThrow()
    })
  })

  describe('getRecordCount', () => {
    it('should return a number', async () => {
      const count = await service.getRecordCount()
      expect(typeof count).toBe('number')
    })
  })
})