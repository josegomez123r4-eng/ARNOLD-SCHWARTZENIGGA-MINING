type VercelRequest = { method?: string; query: Record<string, string | string[] | undefined> }
type VercelResponse = {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value
  const owner = one(req.query.owner)?.trim()
  const master = one(req.query.master)?.trim()
  if (!owner || !master) return res.status(400).json({ error: 'Missing owner or master address' })

  try {
    const base = 'https://tonapi.io/v2/accounts/' + encodeURIComponent(owner)
    const specific = await fetch(base + '/jettons/' + encodeURIComponent(master), {
      headers: { accept: 'application/json' }
    })
    if (specific.ok) {
      const data = await specific.json() as { balance?: string; jetton?: { decimals?: number } }
      if (typeof data.balance === 'string') {
        return res.status(200).json({ balance: data.balance, decimals: data.jetton?.decimals ?? 9 })
      }
    }

    const list = await fetch(base + '/jettons?limit=1000', {
      headers: { accept: 'application/json' }
    })
    if (!list.ok) {
      return res.status(502).json({ error: 'TonAPI returned HTTP ' + list.status })
    }
    const data = await list.json() as {
      balances?: Array<{ balance: string; jetton: { address: string; decimals?: number } }>
    }
    return res.status(200).json({ balances: data.balances ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return res.status(502).json({ error: 'Balance provider request failed: ' + message })
  }
}
