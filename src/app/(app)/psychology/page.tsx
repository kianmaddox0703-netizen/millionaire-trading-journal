import { pageContext } from "@/server/page";
import { summarize } from "@/domain/metrics";
import { groupStats } from "@/domain/edge";
import { scaleBuckets } from "@/domain/insights";
import { Card, PageHeader, Table, th, td, cx, StrengthBadge, Note, Empty } from "@/components/ui";
import { fmtR, fmtRate, tone } from "@/lib/format";

export const metadata = { title: "Psychology" };
const TRACKED = ["confident", "calm", "fear", "greed", "fomo", "frustration", "revenge", "boredom", "hesitation", "anxiety", "excitement"];

export default async function Psychology() {
  const { closed } = await pageContext();
  if (!closed.length) return <><PageHeader title="Psychology" /><Empty title="No trades yet" /></>;
  const base = summarize(closed).avgR;
  const conf = scaleBuckets(closed, (t) => t.confidence, base);
  const disc = scaleBuckets(closed, (t) => t.discipline, base);
  const plan = groupStats(closed.filter((t) => t.followedPlan !== null), (t) => (t.followedPlan ? "Followed plan" : "Did not follow plan"), base);
  const phases = [
    { k: "Before entry", f: (t: (typeof closed)[number]) => t.emotionBefore },
    { k: "During trade", f: (t: (typeof closed)[number]) => t.emotionDuring },
  ];
  const Rows = ({ rows }: { rows: ReturnType<typeof groupStats> }) => (
    <Table>
      <thead><tr>{["Condition", "n", "Win rate", "95% range", "Avg R", "Total R", "Evidence"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((g) => (
        <tr key={g.key} className={g.n < 10 ? "opacity-60" : undefined}>
          <td className={td}>{g.key}</td><td className={cx(td, "num")}>{g.n}</td><td className={cx(td, "num")}>{fmtRate(g.winRate)}</td>
          <td className={cx(td, "num text-faint")}>{g.winRateCi ? `${Math.round(g.winRateCi.low * 100)}–${Math.round(g.winRateCi.high * 100)}%` : "—"}</td>
          <td className={cx(td, "num", tone(g.avgR))}>{fmtR(g.avgR)}</td><td className={cx(td, "num", tone(g.totalR))}>{fmtR(g.totalR, 1)}</td><td className={td}><StrengthBadge s={g.strength} /></td>
        </tr>
      ))}</tbody>
    </Table>
  );
  return (
    <>
      <PageHeader title="Psychology" sub="How your state of mind lines up with outcomes." />
      <Note tone="neutral">Every row shows its sample size and a 95% range for the win rate. Rows with fewer than 10 trades are dimmed: treat them as anecdotes. Correlation is not causation.</Note>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Confidence (1–10)" pad={false}><Rows rows={conf.filter((g) => g.n > 0)} /></Card>
        <Card title="Discipline (1–10)" pad={false}><Rows rows={disc.filter((g) => g.n > 0)} /></Card>
        {phases.map((p) => (
          <Card key={p.k} title={`Emotion ${p.k.toLowerCase()}`} pad={false}>
            <Rows rows={groupStats(closed, p.f, base).sort((a, b) => TRACKED.indexOf(a.key) - TRACKED.indexOf(b.key))} />
          </Card>
        ))}
        <Card title="Plan adherence" pad={false}><Rows rows={plan} /></Card>
        <Card title="Self-reported flags" pad={false}>
          <Rows rows={[
            ["FOMO", "fomo"], ["Revenge", "revenge"], ["Moved stop", "moved_stop"], ["Exited early", "early_exit"], ["Late entry", "late_entry"], ["Overtraded", "overtrading"],
          ].map(([l, k]) => groupStats(closed.filter((t) => t.mistakes.includes(k)), () => l, base)[0]).filter(Boolean)} />
        </Card>
      </div>
    </>
  );
}
