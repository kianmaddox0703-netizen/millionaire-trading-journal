import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { AuthForm } from "../AuthForm";
import { register } from "../actions";

export const metadata = { title: "Create account" };
export default async function Page() {
  if (await getUser()) redirect("/dashboard");
  return <AuthForm mode="register" action={register} />;
}
