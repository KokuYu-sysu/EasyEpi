import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImportService } from '@main/services/import.service'

describe('ImportService', () => {
  let service: ImportService

  beforeEach(() => {
    service = new ImportService()
  })

  describe('validateQES', () => {
    it('should return invalid for non-existent file', async () => {
      const result = await service.validateQES('/nonexistent/file.qes')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('QES file not found')
    })
  })

  describe('previewImport', () => {
    it('should throw for non-existent file', async () => {
      await expect(
        service.previewImport('/nonexistent/file.qes')
      ).rejects.toThrow('QES_FILE_NOT_FOUND')
    })
  })
})