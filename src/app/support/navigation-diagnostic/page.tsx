import { notFound } from "next/navigation";
import NavigationDiagnosticClient from "./NavigationDiagnosticClient";

export default function NavigationDiagnosticPage() {
  if (process.env.CONFIGURATION_ENVIRONMENT === "production") notFound();
  return <NavigationDiagnosticClient deploymentId={process.env.DEPLOYMENT_VERSION ?? "unknown"} />;
}
