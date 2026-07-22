import type { ReactElement } from 'react'
import { expectTypeOf, test } from 'vitest'
import type { ConfirmDialogProps, ModalProps } from '@renderer/components/ui'

test('overlay triggers require one cloneable React element', () => {
  expectTypeOf<ModalProps['trigger']>().toEqualTypeOf<ReactElement>()
  expectTypeOf<ConfirmDialogProps['trigger']>().toEqualTypeOf<ReactElement>()
})
