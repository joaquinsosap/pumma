import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { billingEnabled } from "@/lib/billing/access";

export const metadata: Metadata = { title: "Create account · P.U.M.M.A" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  // Hosted-plan signups continue straight into the hosted checkout.
  const redirectTo =
    plan === "hosted" && billingEnabled() ? "/checkout/start" : "/";
  return <AuthForm mode="register" redirectTo={redirectTo} />;
}
