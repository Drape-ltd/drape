import { Suspense } from 'react'
import { ChooseAccountRole } from '../../../components/choose-account-role'

export default function ChooseRolePage(): React.JSX.Element {
  return (
    <Suspense>
      <ChooseAccountRole />
    </Suspense>
  )
}
