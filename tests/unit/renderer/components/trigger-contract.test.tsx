import type { ReactElement } from 'react'
import { expectTypeOf, test } from 'vitest'
import type { ConfirmDialogProps, ModalProps } from '@renderer/components/ui'

test('modal trigger is optional while confirm trigger stays required', () => {
  expectTypeOf<ModalProps['trigger']>().toEqualTypeOf<ReactElement | undefined>()
  expectTypeOf<ConfirmDialogProps['trigger']>().toEqualTypeOf<ReactElement>()
})
