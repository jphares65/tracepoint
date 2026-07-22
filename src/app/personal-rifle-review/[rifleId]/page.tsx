import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ rifleId: string }>;
};

export default async function PersonalRifleReviewRedirect({
  params,
}: PageProps) {
  const { rifleId } = await params;
  redirect(`/firearms/personal-rifles?record=${rifleId}&view=review`);
}
