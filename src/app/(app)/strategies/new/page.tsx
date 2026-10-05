import { StrategyForm } from "@/components/StrategyForm";
import { PageHeader, Button } from "@/components/ui";
import { addFxAlexgTemplate } from "../actions";

export const metadata = { title: "New strategy" };
export default function NewStrategy() {
  return (
    <>
      <PageHeader title="New strategy" actions={<form action={addFxAlexgTemplate}><Button>Add FXAlexG template instead</Button></form>} />
      <StrategyForm v={{ name: "", description: "", preferredSessions: "", preferredPairs: "", preferredConditions: "", isActive: true, rule: "", confirmation: "", invalidation: "", checklist: "", setups: "" }} />
    </>
  );
}
