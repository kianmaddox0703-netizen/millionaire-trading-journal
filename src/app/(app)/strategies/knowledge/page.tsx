import { asc } from "drizzle-orm";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db";
import { ensureKb } from "@/server/trades";
import { KB_AREAS } from "@/domain/kb/fxalexg";
import { Card, PageHeader, Badge, Note, cx } from "@/components/ui";

export const metadata = { title: "FXAlexG knowledge base" };

const CAT: Record<string, string> = {
  core_rule: "Core rule", optional_confirmation: "Optional confirmation", personal_preference: "Personal preference", psychology: "Psychology",
  context_dependent: "Context-dependent", example: "Example", third_party: "Third-party interpretation", not_established: "Not established",
};
const CONF_TONE = { high: "profit", medium: "info", low: "warn", none: "neutral" } as const;

export default async function Knowledge() {
  await requireUser();
  if (!db.select().from(schema.kbConcepts).limit(1).get()) ensureKb();
  const concepts = db.query.kbConcepts.findMany({ with: { sources: true }, orderBy: asc(schema.kbConcepts.name) }).sync();
  return (
    <>
      <PageHeader title="FXAlexG methodology" sub="Structured knowledge base with sources and confidence for every concept." />
      <Note tone="warn">
        No YouTube video could be watched or transcribed during research: YouTube was blocked from the research environment and the <code>@fxalexg</code> handle now belongs to an unrelated channel (his channel is <code>@fxalexg__</code>). These concepts come from his public Telegram posts and website, plus clearly labelled third-party sources. Anything without support is marked “Not established from available source material.” Full notes: docs/01-research.md.
      </Note>
      <div className="mt-3 space-y-3">
        {KB_AREAS.map((area) => {
          const items = concepts.filter((c) => c.area === area);
          if (!items.length) return null;
          return (
            <Card key={area} title={area}>
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((c) => (
                  <article key={c.slug} id={c.slug} className={cx("scroll-mt-16 rounded border border-line bg-surface-2 p-3", c.confidence === "none" && "border-dashed")}>
                    <header className="mb-1 flex flex-wrap items-center gap-1.5">
                      <h3 className="mr-auto text-[13px] font-medium">{c.name}</h3>
                      <Badge>{CAT[c.category]}</Badge>
                      <Badge tone={CONF_TONE[c.confidence]}>{c.confidence === "none" ? "No support" : `${c.confidence} confidence`}</Badge>
                    </header>
                    <p className="text-[12px] leading-relaxed">{c.definition}</p>
                    {c.examples && <p className="mt-1 text-[12px] text-muted">Example: {c.examples}</p>}
                    {c.exceptions && <p className="mt-1 text-[12px] text-muted">Caveat: {c.exceptions}</p>}
                    {c.related && <p className="mt-1 text-[11px] text-faint">Related: {c.related.split(",").map((r, i) => <a key={r} href={`#${r}`} className="text-info">{i ? ", " : ""}{concepts.find((x) => x.slug === r)?.name ?? r}</a>)}</p>}
                    {c.sources.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-t border-line pt-1.5 text-[11px] text-muted">
                        {c.sources.map((s) => (
                          <li key={s.id}><Badge className="mr-1" tone={s.kind === "primary" ? "info" : "neutral"}>{s.kind === "third_party" ? "third-party" : s.kind}</Badge><a href={s.url} target="_blank" rel="noreferrer noopener" className="text-fg underline decoration-line-strong underline-offset-2 hover:text-info">{s.title}</a>{s.locator && ` · ${s.locator}`}: {s.summary}</li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
