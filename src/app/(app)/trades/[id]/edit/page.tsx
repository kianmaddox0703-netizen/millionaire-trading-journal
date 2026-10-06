import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { tradeFormData } from "@/server/formdata";
import { tradeFormValues } from "@/server/tradeValues";
import { TradeForm } from "@/components/trade/TradeForm";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit trade" };

export default async function EditTrade({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const initial = tradeFormValues(user.id, id, user.timezone);
  if (!initial) notFound();
  return (
    <>
      <PageHeader title={`Edit ${initial.symbol} trade`} />
      <TradeForm data={tradeFormData(user.id)} initial={initial} tradeId={id} aiReady={aiConfigured()} />
    </>
  );
}
