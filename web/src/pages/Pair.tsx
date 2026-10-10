import { useSearchParams } from 'react-router-dom'
import { ApproveCode } from '../components/settings/SignInSettings'
import { Card } from '../components/ui'

/**
 * /pair: approve the code a TV app or a browser away from home is showing —
 * the address that device names, opened on one that's signed in.
 */
export default function Pair() {
  const [params] = useSearchParams()
  return (
    <div className="max-w-xl mx-auto py-10">
      <Card className="p-6 space-y-4">
        <div>
          <h1 className="font-display font-bold uppercase text-[26px] leading-none tracking-[0.06em]">Approve a device</h1>
          <p className="mt-2 text-[13.5px] text-ink-muted leading-relaxed">
            Type the code the TV app or the other browser is showing, and it’s signed in. You can name it, so you know it later in Settings → Sign-in.
          </p>
        </div>
        <ApproveCode initialCode={params.get('code') ?? ''} />
      </Card>
    </div>
  )
}
