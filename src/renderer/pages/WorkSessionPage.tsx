import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function WorkSessionPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/entry', { replace: true })
  }, [navigate])

  return null
}
