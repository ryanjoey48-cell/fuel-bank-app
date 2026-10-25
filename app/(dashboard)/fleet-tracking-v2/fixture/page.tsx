import { notFound } from "next/navigation";
import { FleetTrackingV2Workspace } from "@/components/fleet-tracking-v2/workspace";

export default function FleetTrackingV2FixturePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <FleetTrackingV2Workspace />;
}