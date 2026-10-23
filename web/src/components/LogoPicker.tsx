import { useEffect, useRef, useState } from 'react'
import { api, logoImageUrl, type Logo } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { Select } from './ui'

// A logo dropdown with an inline "+ Upload" so you never have to leave the page
// to add a logo. Self-contained: fetches its own list and refreshes after upload.
// The MosaicTV logo that ships with the app comes first, marked the default.
export default function LogoPicker({
  value,
  onChange,
  noneLabel = 'No logo',
}: {
  value: number | null
  onChange: (logoId: number | null) => void
  noneLabel?: string
}) {
  const [logos, setLogos] = useState<Logo[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () =>
    api
      .logos()
      .then((ls) => setLogos([...ls.filter((l) => l.builtIn), ...ls.filter((l) => !l.builtIn)]))
      .catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = rej
        r.readAsDataURL(f)
      })
      const name = f.name.replace(/\.[^.]+$/, '') || 'Logo'
      const logo = await api.uploadLogo(name, dataUrl)
      await refresh()
      onChange(logo.id)
    } catch (err) {
      setError(errorMessage(err, 'Upload failed'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <div className="flex gap-2 items-center">
        <Select
          className="flex-1 min-w-0"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{noneLabel}</option>
          {logos.map((l) => (
            <option key={l.id} value={l.id}>
              {l.builtIn ? `${l.name} (default)` : l.name}
            </option>
          ))}
        </Select>
        {value != null && (
          <img src={logoImageUrl(value)} alt="" className="w-10 h-10 rounded-xl object-contain bg-white/[0.04] border border-white/[0.08] shrink-0" />
        )}
        <label className="inline-flex h-10 items-center rounded-full border border-white/[0.14] bg-white/[0.05] px-4 text-sm font-semibold text-ink hover:bg-white/[0.1] hover:border-white/[0.22] cursor-pointer shrink-0 whitespace-nowrap transition-colors">
          {uploading ? 'Uploading…' : '+ Upload'}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onFile} disabled={uploading} />
        </label>
      </div>
      {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
    </div>
  )
}
