import { notFound } from "next/navigation";
import { RouteReplayPrototype } from "@/components/fleet-tracking-v2/route-replay-prototype";

export default function RouteReplayFixturePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <RouteReplayPrototype />;
}
