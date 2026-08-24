import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { formatMoney, money } from '@tracker-engine/core'
import { syncStamp } from '@tracker-engine/local-first'
import { db } from './db'
import type { Account, Category, Transaction } from './domain'
import { LedgerSyncEngine } from './sync/engine'
import { enqueue } from './sync/deps'
import { MockBankBackend } from './sync/mockBackend'
import { SEED_CATEGORIES, seedBankBackend } from './seed'
import * as metrics from './metrics'

const usd = (minor: number) => formatMoney(money(minor, 'USD'))
const pct = (r: number) => `${Math.round(r * 100)}%`

export default function App() {
  const backend = useRef<MockBankBackend | null>(null)
  const engine = useRef<LedgerSyncEngine | null>(null)
  if (backend.current === null) {
    backend.current = new MockBankBackend()
    seedBankBackend(backend.current)
    engine.current = new LedgerSyncEngine(backend.current)
  }

  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [pushed, setPushed] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function reload() {
    setAccounts(await db.accounts.toArray())
    setTransactions(await db.transactions.toArray())
    setCategories(await db.categories.toArray())
    setPushed(backend.current!.pushed.map((p) => `${p.table}/${p.rowId}`))
  }

  useEffect(() => {
    void (async () => {
      if ((await db.categories.count()) === 0) await db.categories.bulkPut(SEED_CATEGORIES)
      await reload()
    })()
  }, [])

  async function syncBank() {
    setBusy(true)
    await engine.current!.pull() // pulls server-authored accounts + transactions
    await reload()
    setBusy(false)
  }

  async function addCategory(name: string) {
    const cat: Category = {
      id: crypto.randomUUID(),
      name,
      icon: '🏷️',
      ...syncStamp(),
    }
    await db.categories.put(cat)
    await enqueue('categories', cat.id) // client-authored → will push
    setBusy(true)
    await engine.current!.drainUntilSettled()
    await reload()
    setBusy(false)
  }

  const catName = useMemo(
    () => new Map(categories.map((c) => [c.id, `${c.icon} ${c.name}`])),
    [categories],
  )

  // All derived numbers come from the canonical metrics layer, not inline math.
  const netWorth = metrics.netWorthMinor(accounts)
  const income = transactions.filter((t) => t.amountMinor > 0).reduce((s, t) => s + t.amountMinor, 0)
  const spend = transactions.filter((t) => t.amountMinor < 0).reduce((s, t) => s + t.amountMinor, 0)
  const savings = metrics.savingsRate(transactions)
  const byCategory = useMemo(() => metrics.spendingByCategory(transactions), [transactions])
  const subscriptions = useMemo(() => metrics.detectRecurring(transactions), [transactions])

  const synced = transactions.length > 0

  return (
    <main style={S.page}>
      <header style={S.header}>
        <h1 style={S.h1}>Ledger <span style={S.tag}>demo</span></h1>
        <p style={S.sub}>
          Running on <code>@tracker-engine/core</code> + <code>@tracker-engine/local-first</code> —
          the same engine that powers REPutation.
        </p>
      </header>

      <section style={S.cards}>
        <Stat label="Net worth" value={usd(netWorth)} hint={`${accounts.length} accounts`} />
        <Stat label="Income (this period)" value={usd(income)} />
        <Stat label="Spending (this period)" value={usd(spend)} />
        <Stat label="Savings rate" value={pct(savings)} hint="income kept" />
      </section>

      <div style={S.actions}>
        <button style={S.primary} onClick={syncBank} disabled={busy}>
          {synced ? 'Re-sync bank' : 'Sync bank'}
        </button>
        <button style={S.ghost} onClick={() => addCategory(`Custom ${categories.length + 1}`)} disabled={busy}>
          + Add category (client-authored → pushes)
        </button>
      </div>

      {!synced ? (
        <p style={S.empty}>Press <b>Sync bank</b> to pull accounts &amp; transactions through the engine.</p>
      ) : (
        <section style={S.grid}>
          <div style={S.panel}>
            <h2 style={S.h2}>Spending by category</h2>
            {byCategory.map(({ categoryId, totalMinor }) => (
              <div key={categoryId} style={S.row}>
                <span>{catName.get(categoryId) ?? categoryId}</span>
                <b>{usd(totalMinor)}</b>
              </div>
            ))}
          </div>
          <div style={S.panel}>
            <h2 style={S.h2}>Transactions <span style={S.badge}>server-authored · pull-only</span></h2>
            {transactions
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((t) => (
                <div key={t.id} style={S.row}>
                  <span>{t.date} · {t.merchant}</span>
                  <b style={{ color: t.amountMinor < 0 ? '#b4213a' : '#1a7f4b' }}>{usd(t.amountMinor)}</b>
                </div>
              ))}
          </div>
        </section>
      )}

      {synced && subscriptions.length > 0 && (
        <section style={S.panel}>
          <h2 style={S.h2}>Detected subscriptions <span style={S.badge}>pattern analysis</span></h2>
          {subscriptions.map((r) => (
            <div key={r.merchant} style={S.row}>
              <span>{r.merchant} · {r.cadence} · {r.count}× charges</span>
              <b>{usd(r.avgAmountMinor)}</b>
            </div>
          ))}
        </section>
      )}

      <section style={S.panel}>
        <h2 style={S.h2}>What the engine pushed</h2>
        {pushed.length === 0 ? (
          <p style={S.dim}>Nothing pushed yet. Add a category — only client-authored rows push; bank
            transactions never do (they're <code>serverAuthored</code>).</p>
        ) : (
          <ul style={S.list}>{pushed.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
        )}
      </section>
    </main>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statValue}>{value}</div>
      {hint ? <div style={S.dim}>{hint}</div> : null}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  page: { maxWidth: 860, margin: '0 auto', padding: 24, fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#1a1a1a' },
  header: { marginBottom: 20 },
  h1: { fontSize: 30, margin: 0 },
  tag: { fontSize: 13, verticalAlign: 'middle', background: '#eee', borderRadius: 6, padding: '2px 8px', marginLeft: 8, color: '#666' },
  sub: { color: '#666', marginTop: 6 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 },
  stat: { border: '1px solid #eee', borderRadius: 12, padding: 16 },
  statLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: 24, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' },
  actions: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  primary: { background: '#5b46e5', color: '#fff', border: 0, borderRadius: 10, padding: '10px 16px', fontWeight: 600, cursor: 'pointer' },
  ghost: { background: '#fff', color: '#333', border: '1px solid #ddd', borderRadius: 10, padding: '10px 16px', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 },
  panel: { border: '1px solid #eee', borderRadius: 12, padding: 16, marginBottom: 16 },
  h2: { fontSize: 15, margin: '0 0 10px' },
  row: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f4f4f4', fontVariantNumeric: 'tabular-nums' },
  badge: { fontSize: 11, background: '#eef', color: '#5b46e5', borderRadius: 6, padding: '2px 6px', marginLeft: 6 },
  empty: { color: '#666', padding: 24, textAlign: 'center', border: '1px dashed #ddd', borderRadius: 12 },
  dim: { color: '#999', fontSize: 13 },
  list: { margin: 0, paddingLeft: 18 },
}
