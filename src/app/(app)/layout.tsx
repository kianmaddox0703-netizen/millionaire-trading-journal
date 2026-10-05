import { requireUser } from "@/server/auth";
import { userAccounts } from "@/server/analytics";
import { selectedAccount } from "@/server/prefs";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { logout } from "../(auth)/actions";
import { selectAccount } from "./shell-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const accounts = userAccounts(user.id).map((a) => ({ id: a.id, name: a.name }));
  const sel = (await selectedAccount(user.id)) ?? "all";
  return (
    <div className="flex min-h-dvh">
      <Sidebar logout={logout} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar accounts={accounts} selected={sel} selectAccount={selectAccount} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5">{children}</main>
      </div>
    </div>
  );
}
