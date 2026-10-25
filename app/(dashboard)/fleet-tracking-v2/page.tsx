import { FleetTrackingV2LiveWorkspace } from "@/components/fleet-tracking-v2/live-workspace";

export default function FleetTrackingV2LivePage() {
  return <FleetTrackingV2LiveWorkspace showFixtureLink={process.env.NODE_ENV === "development"} />;
}