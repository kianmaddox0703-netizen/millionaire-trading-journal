import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { AuthForm } from "../AuthForm";
import { login } from "../actions";

export const metadata = { title: "Sign in" };
export default async function Page() {
  if (await getUser()) redirect("/dashboard");
  return <AuthForm mode="login" action={login} />;
}
