import Link from "next/link";
import { Card } from "@/components/ui";

export default function NotFound() {
  return (
    <Card title="Not found" className="mx-auto mt-8 max-w-lg">
      <p className="text-[13px]">This page or record doesn't exist, or it belongs to another account.</p>
      <div className="mt-3 flex gap-3 text-[13px]">
        <Link className="text-info underline underline-offset-2" href="/trades">Trade log</Link>
        <Link className="text-info underline underline-offset-2" href="/dashboard">Dashboard</Link>
      </div>
    </Card>
  );
}
