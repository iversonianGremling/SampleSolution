import { useQuery } from '@tanstack/react-query'
import * as api from '../api/client'

export function useSourceTree() {
  return useQuery({
    queryKey: ['sourceTree'],
    queryFn: api.getSourceTree,
  })
}
