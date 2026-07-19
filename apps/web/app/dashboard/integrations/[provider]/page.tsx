import { IntegrationProviderPage } from "@/components/integration-provider-page";
import { integrationProviders, type IntegrationProvider } from "@/lib/server/integrations/types";
import { notFound } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!integrationProviders.includes(provider as IntegrationProvider)) notFound();
  return <IntegrationProviderPage provider={provider as IntegrationProvider} />;
}
