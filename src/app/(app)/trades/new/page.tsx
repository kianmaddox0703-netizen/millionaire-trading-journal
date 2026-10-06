import { pageContext } from "@/server/page";
import { tradeFormData } from "@/server/formdata";
import { TradeForm } from "@/components/trade/TradeForm";
import { emptyValues } from "@/lib/tradeFormValues";
import { PageHeader } from "@/components/ui";
import { aiConfigured } from "@/server/ai/client";

export const metadata = { title: "Add trade" };

export default async function NewTrade() {
  const { user, accountId, accounts } = await pageContext();
  const data = tradeFormData(user.id);
  return (
    <>
      <PageHeader title="Add trade" sub="Symbol, direction, entry, SL and TP are enough. Everything else is optional and can be added later." />
      <TradeForm data={data} initial={emptyValues(accountId ?? accounts[0]?.id ?? "")} aiReady={aiConfigured()} />
    </>
  );
}
