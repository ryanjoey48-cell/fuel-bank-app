export type FleetV2SummaryRecord = {
  activity: "driving" | "uncertain" | "stopped_engine_on" | "stopped_engine_off" | "stopped_engine_unknown" | "unavailable";
  gpsConfidence: "verified" | "unverified" | "unavailable";
  reportFreshness: string;
};

export function summarizeLiveFleet(records: FleetV2SummaryRecord[]) {
  return records.reduce((summary, record) => {
    if (record.activity === "driving") summary.activity.driving += 1;
    else if (record.activity === "uncertain") summary.activity.uncertain += 1;
    else if (record.activity.startsWith("stopped_")) summary.activity.stopped += 1;
    else summary.activity.unavailable += 1;

    if (record.gpsConfidence === "verified") summary.gps.verified += 1;
    else if (record.gpsConfidence === "unverified") summary.gps.unverified += 1;
    else summary.gps.unavailable += 1;

    if (record.reportFreshness === "current") summary.reports.current += 1;
    else if (record.reportFreshness === "stale") summary.reports.stale += 1;
    else summary.reports.unknown += 1;

    return summary;
  }, {
    activity: { driving: 0, stopped: 0, uncertain: 0, unavailable: 0 },
    gps: { verified: 0, unverified: 0, unavailable: 0 },
    reports: { current: 0, stale: 0, unknown: 0 }
  });
}
