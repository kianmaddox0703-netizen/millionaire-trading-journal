import Link from "next/link";
import { pageContext } from "@/server/page";
import { summarize } from "@/domain/metrics";
import { ymd, addDays, weekStartOf } from "@/domain/sessions";
import { Card, PageHeader, LinkButton, cx } from "@/components/ui";
import { fmtMoney, fmtMoneyShort, fmtR, fmtRate, tone } from "@/lib/format";

export const metadata = { title: "Calendar" };

export default async function Calendar({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { closed, tz, currency } = await pageContext();
  const today = ymd(new Date(), tz);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const first = `${month}-01`;
  const gridStart = weekStartOf(first);
  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const monthTrades = closed.filter((t) => t.day.startsWith(month));
  const ms = summarize(monthTrades);
  const maxAbs = Math.max(1, ...Object.values(Object.groupBy(monthTrades, (t) => t.day)).map((ts) => Math.abs((ts ?? []).reduce((a, t) => a + (t.netPnl ?? 0), 0))));

  const weeks: string[][] = [];
  for (let d = gridStart; weeks.length < 6; ) {
    const w: string[] = [];
    for (let i = 0; i < 7; i++, d = addDays(d, 1)) w.push(d);
    weeks.push(w);
    if (!d.startsWith(month) && d > first) break;
  }
  const title = new Date(first + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader title="Calendar" sub={`${title} · ${ms.count} trades · ${fmtMoney(ms.netPnl, currency, true)} · ${fmtR(ms.totalR, 1)}`}
        actions={<><LinkButton href={`/calendar?m=${prev}`}>← Prev</LinkButton><LinkButton href="/calendar">Today</LinkButton><LinkButton href={`/calendar?m=${next}`}>Next →</LinkButton></>} />
      <Card pad={false}>
        <div className="scroll-thin overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-[repeat(7,1fr)_110px]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Week"].map((d) => <div key={d} className="border-b border-line px-2 py-1.5 text-[11px] text-muted">{d}</div>)}
            {weeks.map((w) => {
              const wts = closed.filter((t) => t.day >= w[0] && t.day <= w[6]);
              const ws = summarize(wts);
              return [
                ...w.map((d) => {
                  const ts = closed.filter((t) => t.day === d);
                  const s = summarize(ts);
                  const inMonth = d.startsWith(month);
                  const mistakes = ts.reduce((a, t) => a + t.mistakes.length, 0);
                  const emo = Object.entries(Object.groupBy(ts.filter((t) => t.emotionBefore), (t) => t.emotionBefore!)).sort((a, b) => (b[1]?.length ?? 0) - (a[1]?.length ?? 0))[0]?.[0];
                  const intensity = ts.length ? Math.min(1, Math.abs(s.netPnl) / maxAbs) : 0;
                  const bg = !ts.length ? undefined : s.netPnl >= 0 ? `rgba(47,191,113,${0.05 + intensity * 0.17})` : `rgba(239,83,80,${0.05 + intensity * 0.17})`;
                  const body = (
                    <div className={cx("h-[92px] border-b border-r border-line/60 p-1.5 text-[11px]", !inMonth && "bg-bg", d === today && "ring-1 ring-inset ring-info")} style={{ background: bg }}>
                      <div className="flex items-center justify-between text-faint"><span className="num">{Number(d.slice(8))}</span>{mistakes > 0 && <span className="text-warn" title="Mistakes">⚠ {mistakes}</span>}</div>
                      {ts.length > 0 && (
                        <div className="mt-1 space-y-px">
                          <div className={cx("num text-[13px] font-medium", tone(s.netPnl))}>{fmtMoneyShort(s.netPnl)}</div>
                          <div className="num text-muted">{ts.length}t · {fmtRate(s.winRate)} · {fmtR(s.totalR, 1)}</div>
                          {emo && <div className="truncate text-muted">{emo}</div>}
                        </div>
                      )}
                    </div>
                  );
                  return ts.length ? <Link key={d} href={`/trades?from=${d}&to=${d}`} className="hover:brightness-125">{body}</Link> : <div key={d}>{body}</div>;
                }),
                <Link key={w[0] + "w"} href={`/reviews/week/${w[0]}`} className="h-[92px] border-b border-line/60 bg-surface-2 p-1.5 text-[11px] hover:bg-surface-3">
                  <div className="text-faint">Review →</div>
                  {wts.length > 0 && <><div className={cx("num mt-1 text-[13px] font-medium", tone(ws.netPnl))}>{fmtMoneyShort(ws.netPnl)}</div><div className="num text-muted">{ws.count}t · {fmtR(ws.totalR, 1)}</div></>}
                </Link>,
              ];
            })}
          </div>
        </div>
      </Card>
    </>
  );
}
