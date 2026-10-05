import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/login");
  redirect(session.user.role === "member" ? "/member" : "/admin");
}
