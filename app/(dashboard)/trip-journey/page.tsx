"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Gauge,
  Link2,
  MapPinned,
  RefreshCw,
  Save,
  Trash2,
  Unlink
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LocationAutocomplete, type StructuredLocation } from "@/components/location-autocomplete";
import {
  createTripJourneyFromBooking,
  deleteTripJourney,
  fetchBookingDiaryEntries,
  fetchFuelLogs,
  fetchDrivers,
  fetchTripJourneys,
  fetchWeeklyMileage,
  fetchVehicles,
  linkFuelLogToTrip,
  saveTripJourney,
  unlinkFuelLogFromTrip
} from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import type { TrafficAwareRouteEstimate } from "@/lib/route-planning";
import type { Driver, FuelLogWithDriver, TripFuelSource, TripJourneyWithFuel, Vehicle, WeeklyMileageEntry } from "@/types/database";

const DEPOT_ADDRESS =
  "Expert Express Sender Co., Ltd. 88 Happy Place, Khwaeng Khlong Sam Prawet, Khet Lat Krabang, Bangkok 10520, Thailand";

const tripJourneyCopy = {
  en: {
    tripJourney: "Trip Journey",
    booking: "Booking",
    dataStatus: "Data status",
    tripPerformance: "TRIP CHECKS",
    description: "Verify completed jobs against booking, route, mileage and fuel data.",
    refresh: "Refresh",
    tripStatus: "Trip Status",
    operationsOverview: "Operations Overview",
    fleetDistance: "Fleet Distance",
    tripsCompleted: "Trips completed",
    completedTripsLabel: "Completed trips",
    tripsInProgress: "Trips in progress",
    overallCompletion: "Overall completion",
    fleetPerformance: "Trip Data Readiness",
    fleetPerformanceHelper: "Completed jobs with linked booking, distance, fuel, and mileage checks ready.",
    driverLeaderboard: "Driver Leaderboard",
    topDriversHelper: "Top 5 drivers from completed trips.",
    routeAccuracy: "Route Accuracy",
    averageDifference: "Average Difference",
    largestDifference: "Largest Difference",
    mostAccurateRoute: "Most Accurate Route",
    leastAccurateRoute: "Least Accurate Route",
    monthlyTrends: "Monthly Trends",
    tripsCompletedTrend: "Trips Completed",
    distanceTravelledTrend: "Distance Travelled",
    fuelUsedTrend: "Fuel Events",
    fuelCostTrend: "Fuel Event Spend",
    quickFilters: "Quick Filters",
    today: "Today",
    yesterday: "Yesterday",
    thisWeek: "This Week",
    thisMonth: "This Month",
    viewTrips: "Review trips",
    fixNow: "Fix now",
    view: "View",
    edit: "Edit",
    openBooking: "Open Booking",
    openFuelLogs: "Open Fuel Logs",
    completion: "Completion",
    vehicleRegistration: "Registration",
    estimatedVsActual: "Distance difference %",
    distanceTravelled: "Distance travelled",
    journeyTimeline: "Journey Timeline",
    pickup: "Pickup",
    dropoff: "Drop-off",
    additionalStops: "Additional Stops",
    return: "Return",
    trips: "Trips",
    trip: "trip",
    completed: "Completed",
    complete: "Complete",
    missingMileage: "Missing mileage",
    missingMileageTitle: "Missing Mileage",
    missingEstimate: "Missing estimate",
    missingEstimateTitle: "Missing Estimate",
    missingFuel: "Fuel check needed",
    missingFuelTitle: "Fuel data needs review",
    fuelEventNearby: "Fuel data linked",
    noFuelEventNearby: "Fuel not linked",
    weeklyMileageVerified: "Weekly mileage verified",
    mileageVerification: "Mileage verification",
    fuelCycleMileageVerified: "Mileage verified",
    weeklyMileageMissing: "Mileage not verified",
    verified: "Verified",
    needsReview: "Needs Review",
    dataCompletion: "Data Completion",
    adminQueue: "Admin Queue",
    missingTripRecord: "Missing trip record",
    missingFuelEvent: "Fuel not linked",
    missingWeeklyMileage: "Mileage not verified",
    verifiedTrips: "Verified trips",
    verifiedDataCheckedTrips: "Verified / data checked trips",
    totalWorkingKm: "Total working KM",
    verifiedWorkingKm: "Verified working KM",
    comparisonNeedsChecksHelper: "Some completed trips still need fuel or mileage checks. Verified comparison uses Data checked trips.",
    fuelCycle: "Since last fuel log",
    fuelCycles: "Fleet fuel cycles",
    fuelCyclesHelper: "Based on fuel log odometer readings. Individual trip cards may show their own fuel cycle.",
    belongsToFuelCycle: "Belongs to fuel cycle",
    notAssignedToFuelCycle: "Not assigned to fuel cycle yet",
    fuelCycleHelper: "Fuel logs may cover multiple trips. Fuel events are used for cycle and mileage checking, not exact per-trip fuel use.",
    enoughDataNeeded: "Not enough data yet",
    created: "Created",
    distanceFuel: "Distance & Fuel",
    actualKm: "Actual KM",
    mileage: "Mileage",
    actualKmOverride: "Manual KM override",
    actualKmOverrideHelper: "Optional. Use only when admin has confirmed the trip distance manually.",
    workingDistance: "Working KM",
    tripDistanceUsed: "Trip Distance Used",
    distanceSource: "Distance source",
    sourceGoogleEstimate: "Google estimate",
    sourceManualActualKm: "Manual override",
    sourceOdometerVerified: "Odometer actual",
    sourceNotAvailable: "Not available",
    weeklyMileageOk: "OK",
    weeklyMileageWarning: "Warning",
    weeklyMileageNeedsReview: "Needs Review",
    estimatedKm: "Estimated KM",
    difference: "Difference",
    litres: "Litres",
    fuel: "Fuel",
    fuelCost: "Fuel Cost",
    cost: "Cost",
    efficiency: "Efficiency",
    avgKmL: "Avg KM/L",
    avgCostKm: "Avg Cost/KM",
    bestDriver: "Best Driver",
    worstDriver: "Worst Driver",
    filters: "Filters",
    filtersDescription: "Find trips by date, driver, vehicle, route or verification status.",
    allDrivers: "All drivers",
    allVehicles: "All vehicles",
    route: "Route",
    allData: "All data",
    missingDataOnly: "Missing data only",
    completedOnly: "Completed only",
    allFuelLinks: "All fuel links",
    fuelLogsLinked: "Fuel logs linked",
    fuelLogsNotLinked: "Fuel logs not linked",
    fuelLinked: "Fuel linked",
    possibleFuelLogFound: "Possible fuel log found",
    reviewLinkFuelLog: "Review & link fuel log",
    fuelManuallyConfirmed: "Fuel manually confirmed",
    fuelCycleLinked: "Fuel cycle linked",
    fuelLogSupportsTrip: "Fuel log supports this trip",
    fuelLogAlreadyLinkedCount: "Already linked to {count} other trip(s)",
    distanceSinceLastFuelLog: "Distance since last fuel log",
    linkedFuelCycle: "Linked fuel cycle",
    fuelCycleAvailable: "Fuel cycle available",
    fuelCycleVerified: "Fuel cycle checked",
    fuelCycleNotCompleteYet: "Fuel cycle not complete yet",
    fuelCycleDistance: "Fuel cycle distance",
    linkedTripDistanceInCycle: "Trip distance in this cycle",
    unallocatedDistance: "Other / unallocated movement",
    coverage: "Coverage from linked trips",
    partialCycleCoverage: "Partial cycle coverage",
    mileageCheckAvailable: "Mileage check available",
    cycleStatus: "Status",
    fuelCycleNormalHelper: "This is normal. Fuel cycles can include depot movement, other jobs, or trips not yet linked.",
    mileageCheckPending: "Mileage check pending",
    waitingForNextFuelLog: "Waiting for next fuel log",
    needsFuelLogReceiptCheck: "Needs receipt check",
    mileageNeedsReview: "Mileage needs review",
    fuelCycleNotVerified: "Fuel cycle not verified",
    manuallyConfirmFuelCheck: "Manually confirm fuel check",
    manualFuelConfirmationNote: "Fuel checked against weekly mileage / fuel cycle.",
    linkToThisTrip: "Link to this trip",
    rejectSuggestion: "Reject suggestion",
    resetFilters: "Reset filters",
    needsAttention: "Needs Attention",
    needsAttentionDescription: "Select a missing item to focus the trip list.",
    actualKmNeeded: "Distance is needed from an estimate, odometer, GPS, or weekly mileage.",
    comparePlannedActual: "Compare planned vs actual route.",
    linkFuelLogsOrManual: "Link or confirm the fuel data used for this trip.",
    showAllTrips: "Show all trips",
    tripRecords: "Trip Records",
    tripRecordsDescription: "Review each booking journey and confirm distance, mileage and fuel checks.",
    newestTripsFirst: "Newest trips first.",
    loadingTripJourneys: "Loading trip journeys...",
    noTripRecordsYet: "No Trip Journeys have been created yet.",
    noTripRecordsDescription: "Create a Booking and select \"Create Trip Journey\" or open a Booking Diary entry and click \"Create Trip\".",
    selectedTrip: "Selected trip",
    reviewEdit: "Review / Edit",
    delete: "Delete",
    deleteTrip: "Delete trip",
    needsAttentionAction: "Needs attention",
    loadMoreTrips: "Load more trips",
    selectedTripOverview: "Selected Trip Overview",
    driver: "Driver",
    vehicle: "Vehicle",
    fuelLogs: "Fuel Events",
    noneLinked: "None linked",
    linked: "linked",
    noFuel: "No fuel",
    noFuelCost: "No fuel cost",
    nextAction: "Next action",
    manageFuelLogs: "Manage fuel logs",
    linkFuelLogAction: "Link Fuel Log",
    backToTripList: "Back to trip list",
    overview: "Overview",
    journeyDetails: "Journey Details",
    notes: "Notes",
    date: "Date",
    pickupTime: "Pickup time",
    bookingRef: "Booking ref",
    bookingInfo: "Booking Info",
    driverVehicle: "Driver & Vehicle",
    driverVehicleHelper: "Pulled from the Drivers and Vehicles pages. Manual typing is still allowed.",
    selectOrTypeDriver: "Select or type driver",
    selectOrTypeVehicle: "Select or type vehicle",
    manualDriverEntry: "Manual driver entry",
    manualVehicleEntry: "Manual vehicle entry",
    routeGoogleMaps: "Route & Google Maps",
    routeGoogleMapsHelper: "Booking distance is pickup to drop-off only. Trip Journey can calculate the selected full driver route.",
    calculateRouteDistance: "Calculate route distance",
    calculating: "Calculating...",
    startLocationType: "Start location type",
    startsFromDepot: "Starts from depot",
    startsFromCustom: "Starts from custom location",
    startsPickupDropoffOnly: "No depot / pickup to drop-off only",
    depotAddress: "Depot address",
    startLocation: "Start location",
    enterStartLocation: "Enter start location",
    pickupLocation: "Pickup location",
    dropoffLocation: "Drop-off location",
    googleMapsLocation: "Google Maps location",
    googleMapsUnavailable: "Google Maps is unavailable. Manual entry still works.",
    googleMapsLocationHelper: "Verified Google Maps data is retained from Booking Diary and used for route calculation.",
    googleVerified: "Verified by Google",
    manualUnverified: "manual/unverified",
    manualEntryStillAllowed: "You can still type the full location manually.",
    savedLocationApplied: "Saved location applied",
    previouslyUsedLocation: "Previously used location",
    changeGoogleMapsLocation: "Change Google Maps location",
    noSavedLocationFound: "No saved location found",
    fastestRoute: "Fastest route",
    refreshRoute: "Refresh route",
    trafficAwareEstimate: "Traffic-aware estimate",
    googleRecommendedRoute: "Google recommended route",
    trafficDataUnavailable: "Traffic data unavailable",
    currentTrafficEstimate: "Current-traffic estimate",
    plannedTrafficEstimate: "Planned departure traffic",
    fallbackRouteUsed: "Google's available route was used because no preferred practical route was returned.",
    routeNeedsRefresh: "Route inputs changed. Refresh the traffic-aware estimate.",
    standardDriveWarning: "Standard driving route; truck restrictions are not checked.",
    calculated: "Calculated",
    returnToDepot: "Return to depot",
    routePreview: "Route preview",
    googleEstimatedKm: "Google estimated KM",
    googleEstimatedTime: "Google estimated time",
    routeSource: "Route source",
    bookingEstimate: "Booking estimate",
    bookingEstimateHelper: "Pickup to drop-off only",
    tripJourneyEstimate: "Trip Journey estimate",
    tripJourneyEstimateHelper: "Selected full route",
    routeSummary: "Route summary",
    bookingRouteLabel: "Booking",
    tripRouteLabel: "Trip route",
    pickupDropoffOnly: "Pickup -> Drop-off only",
    tripMapsEstimate: "Trip route Google estimate",
    bookingEstimateFallback: "Booking estimate fallback",
    displayEstimatePriority: "Displayed estimate uses manual override first, then Trip Journey Google estimate, then Booking estimate.",
    openInGoogleMaps: "Open in Google Maps",
    manualEstimatedOverride: "Manual estimated KM override",
    manualEstimateHelper: "Use this if Google Maps is not available or the estimate needs correcting.",
    actualDistance: "Odometer actual",
    manualActualKm: "Manual KM override",
    startMileage: "Start mileage",
    endMileage: "End mileage",
    estimatedKmShort: "Est. KM",
    fuelStatus: "Fuel status",
    saveTrip: "Save trip",
    saving: "Saving...",
    noUnsavedChanges: "No unsaved changes",
    unsavedChanges: "Unsaved changes",
    tripSavedSuccessfully: "Trip saved successfully",
    editDoesNotChangeBooking: "Editing here will not change the original Booking Diary entry.",
    fuelSummary: "Fuel Summary",
    fuelSource: "Fuel source",
    useLinkedFuelLogs: "Use linked fuel logs",
    useManualFuelEntry: "Use manual fuel entry",
    manualLitresUsed: "Manual litres used",
    manualFuelCost: "Manual fuel cost",
    linkedFuelLogs: "Nearby Fuel Events",
    noFuelLogsLinkedYet: "No fuel logs linked yet.",
    unlink: "Unlink",
    addSearchFuelLogs: "Add / Search Fuel Logs",
    hide: "Hide",
    addFuelLog: "Add fuel log",
    suggestedLogs: "Suggested logs",
    noSuggestedFuelLogs: "No suggested fuel logs found.",
    link: "Link",
    searchFuelPlaceholder: "Search vehicle, driver, station, date",
    noOtherFuelLogs: "No other unlinked fuel logs match.",
    loadMore: "Load more",
    waitingIdleNotes: "Waiting / idle notes",
    extraRouteNotes: "Extra route notes",
    performanceComparison: "Operations Comparison",
    comparisonDescription: "Driver and vehicle comparison separates completed trips from Data checked trips. Fuel events are not allocated as exact per-trip fuel use.",
    sortBestKmL: "Sort: Most working km",
    sortLowestCostKm: "Sort: Smallest variance",
    sortHighestFuelCost: "Sort: Largest variance",
    sortMostActualKm: "Sort: Most actual km",
    sortMostCompletedTrips: "Sort: Most completed trips",
    sortWorstKmL: "Sort: Needs review first",
    sortLowestFuelCost: "Sort: Smallest working km",
    sortLongestTrip: "Sort: Longest trip",
    sortShortestTrip: "Sort: Shortest trip",
    sortMostAccurate: "Sort: Most accurate",
    sortLeastAccurate: "Sort: Least accurate",
    moreCompletedTripsNeeded: "More completed verified trips are needed for reliable comparison.",
    reportsSecondary: "Comparison / Reports",
    reportsSecondaryDescription: "Route accuracy, trends, leaderboards, and operations comparison.",
    planned: "Planned",
    inProgress: "In Progress",
    dataReady: "Data Ready",
    dataChecked: "Data checked",
    needsFuelCheck: "Needs Fuel Check",
    needsMileageCheck: "Needs Mileage Check",
    needsReviewStatus: "Needs Review",
    missingDistance: "Missing Distance",
    bookingLinked: "Booking linked",
    bookingNotLinked: "Booking not linked",
    distanceMatched: "Distance matched",
    distanceNeedsReview: "Distance needs review",
    fuelNotLinked: "Fuel not linked",
    mileageNotVerified: "Mileage not verified",
    bestKmLDriver: "Current top driver by working km",
    lowestCostKmDriver: "Current most accurate driver",
    bestVehicle: "Current top vehicle by working km",
    lowestVehicleCostKm: "Current most accurate vehicle",
    mostExpensiveTrip: "Fuel cycle check",
    biggestDistanceDifference: "Biggest distance difference",
    dataQuality: "Data Quality",
    drivers: "Drivers",
    vehicles: "Vehicles",
    routes: "Routes",
    rank: "Rank",
    label: "Label",
    avgEstKm: "Avg est. km",
    avgActualKm: "Avg actual km",
    avgDifference: "Avg difference",
    avgFuelCost: "Fuel cycle check",
    deleteTripQuestion: "Delete trip?",
    deleteTripDescription: "This will delete the trip journey record only. It will not delete the original Booking Diary entry or any Fuel Logs.",
    cancel: "Cancel",
    deleting: "Deleting...",
    reviewPerformance: "Review data",
    addActualKm: "Add actual km",
    addEstimate: "Add estimate",
    reviewDetails: "Review details",
    missingMileageHelper: "Add a Google/booking estimate, odometer distance, GPS distance, or weekly mileage check.",
    missingEstimateHelper: "Estimated KM lets you compare planned vs actual distance.",
    missingFuelHelper: "Link a nearby fuel event or check the fuel cycle for this vehicle.",
    completedHelper: "This trip has route and mileage data. Verify against fuel events or weekly mileage when available.",
    reviewHelper: "Review trip details and complete the missing fields.",
    googleMapsEstimate: "Google Maps estimate",
    manualOverride: "Manual override",
    notCalculated: "Not calculated",
    usingManualActualKm: "Using manual actual km",
    usingMileageCalculation: "Using mileage calculation",
    actualKmMissing: "Actual km missing",
    needsMoreData: "Needs more data",
    limitedData: "Limited data",
    good: "Good",
    bestKmL: "Best KM/L",
    lowestCostKm: "Lowest cost/km",
    overEstimate: "Over estimate",
    highCostKm: "High cost/km",
    lowEfficiency: "Low efficiency",
    average: "Average",
    unknownRoute: "Unknown route",
    depot: "Depot",
    customStart: "Custom start",
    unassigned: "Unassigned",
    missing: "Missing",
    distance: "Distance",
    kmL: "KM/L",
    costKm: "Cost/KM",
    noFuelManualWarning: "Linked fuel logs exist, but this trip is using manual fuel entry.",
    unableToLoadTripJourneys: "Unable to load Trip Journey records.",
    dataQualityNoFuelCost: "Some trips have no valid fuel cost.",
    dataQualityLinkedNoCost: "Some linked fuel logs have no fuel cost.",
    dataQualityEstimateNoActual: "Some trips still have no estimate, odometer, GPS, or weekly mileage distance.",
    dataQualityActualNoFuel: "Some trips have no nearby fuel event or fuel-cycle check yet.",
    driverMatched: "Driver matched from Drivers page.",
    vehicleCanBeTyped: "Vehicle can come from the list or be typed manually.",
    vehicleUpdatedFromDriver: "Vehicle updated from selected driver. You can still change it.",
    manualDriverEntryMessage: "Manual driver entry. Vehicle can still be selected or typed.",
    routeDistanceCalculated: "Trip route distance calculated. Save trip to store it.",
    fuelLogLinked: "Fuel log linked to trip.",
    fuelLogUnlinked: "Fuel log unlinked from trip.",
    routeStartRequired: "Please enter a start location before calculating distance.",
    routePickupDropoffRequired: "Please enter pickup and drop-off locations before calculating distance.",
    routeCalculateFailed: "Could not calculate route distance. You can enter manual estimated KM instead.",
    uuidReferenceError: "A numeric booking or fuel-log reference was sent to a UUID database field. Apply the Trip Journey reference migration, then try again.",
    unableToCompleteAction: "Unable to complete this Trip Journey action."
    ,financialTreatment: "Financial"
    ,includeInFinancials: "Include financial amount"
    ,financialExclusionHelp: "When turned off, mileage and operational data will still be counted, but the financial amount for this trip will be excluded."
    ,financialAmount: "Financial amount"
    ,financialAmountExcluded: "Financial amount excluded"
    ,financiallyExcluded: "Financial excluded"
  },
  th: {
    tripJourney: "เส้นทางการเดินทาง",
    tripPerformance: "การปฏิบัติการทริป",
    description: "เปรียบเทียบเส้นทางจากการจองกับระยะทางจริงและการใช้น้ำมันตามพนักงานขับรถ รถ และเส้นทาง",
    refresh: "รีเฟรช",
    tripStatus: "สถานะทริป",
    trips: "ทริป",
    trip: "ทริป",
    completed: "เสร็จสิ้น",
    complete: "เสร็จสิ้น",
    missingMileage: "ขาดเลขไมล์",
    missingMileageTitle: "ขาดเลขไมล์",
    missingEstimate: "ขาดระยะทางประมาณการ",
    missingEstimateTitle: "ขาดระยะทางประมาณการ",
    missingFuel: "ต้องตรวจสอบน้ำมัน",
    missingFuelTitle: "ต้องตรวจสอบน้ำมัน",
    fuelEventNearby: "มีเหตุการณ์เติมน้ำมันใกล้เคียง",
    noFuelEventNearby: "ไม่มีเหตุการณ์เติมน้ำมันใกล้เคียง",
    weeklyMileageVerified: "ตรวจสอบกับเลขไมล์รายสัปดาห์แล้ว",
    weeklyMileageMissing: "ขาดเลขไมล์รายสัปดาห์",
    verified: "ตรวจสอบแล้ว",
    needsReview: "ต้องตรวจสอบ",
    dataCompletion: "ความครบถ้วนของข้อมูล",
    adminQueue: "คิวงานผู้ดูแล",
    missingTripRecord: "ขาดรายการทริป",
    missingFuelEvent: "ขาดเหตุการณ์เติมน้ำมัน",
    missingWeeklyMileage: "ขาดเลขไมล์รายสัปดาห์",
    verifiedTrips: "ทริปที่ตรวจสอบแล้ว",
    fuelCycle: "รอบน้ำมัน",
    fuelCycles: "รอบน้ำมัน",
    belongsToFuelCycle: "อยู่ในรอบน้ำมัน",
    notAssignedToFuelCycle: "ยังไม่ได้อยู่ในรอบน้ำมัน",
    fuelCycleHelper: "บันทึกน้ำมันอาจครอบคลุมหลายทริป ใช้เป็นเหตุการณ์สำหรับตรวจรอบน้ำมันและเลขไมล์ ไม่ใช่ค่าน้ำมันจริงต่อทริป",
    enoughDataNeeded: "ข้อมูลยังไม่เพียงพอ",
    created: "สร้างแล้ว",
    distanceFuel: "ระยะทางและน้ำมัน",
    actualKm: "กม. จริง",
    actualKmOverride: "กม. จริงที่แก้ไขเอง",
    actualKmOverrideHelper: "ไม่บังคับ เว้นว่างไว้ได้ ยกเว้นมีระยะทางจากเลขไมล์หรือ GPS ที่ยืนยันแล้ว",
    workingDistance: "ระยะทางที่ใช้ทำงาน",
    distanceSource: "แหล่งที่มาระยะทาง",
    sourceGoogleEstimate: "ประมาณการจาก Google",
    sourceManualActualKm: "กม. จริงที่กรอกเอง",
    sourceOdometerVerified: "ตรวจสอบจากเลขไมล์/รายสัปดาห์",
    sourceNotAvailable: "ไม่มีข้อมูล",
    weeklyMileageOk: "ปกติ",
    weeklyMileageWarning: "เตือน",
    weeklyMileageNeedsReview: "ต้องตรวจสอบ",
    estimatedKm: "กม. ประมาณการ",
    difference: "ส่วนต่าง",
    litres: "ลิตร",
    fuel: "น้ำมัน",
    fuelCost: "ค่าน้ำมัน",
    cost: "ค่าใช้จ่าย",
    efficiency: "ประสิทธิภาพ",
    avgKmL: "เฉลี่ย กม./ลิตร",
    avgCostKm: "เฉลี่ยค่าใช้จ่าย/กม.",
    bestDriver: "พนักงานขับรถดีที่สุด",
    worstDriver: "พนักงานขับรถที่ต้องปรับปรุง",
    filters: "ตัวกรอง",
    filtersDescription: "วันที่ พนักงานขับรถ รถ เส้นทาง สถานะข้อมูล และการเชื่อมโยงน้ำมัน",
    allDrivers: "พนักงานขับรถทั้งหมด",
    allVehicles: "รถทั้งหมด",
    route: "เส้นทาง",
    allData: "ข้อมูลทั้งหมด",
    missingDataOnly: "เฉพาะข้อมูลที่ขาด",
    completedOnly: "เฉพาะที่เสร็จสิ้น",
    allFuelLinks: "การเชื่อมโยงน้ำมันทั้งหมด",
    fuelLogsLinked: "เชื่อมโยงบันทึกน้ำมันแล้ว",
    fuelLogsNotLinked: "ยังไม่เชื่อมโยงบันทึกน้ำมัน",
    resetFilters: "รีเซ็ตตัวกรอง",
    needsAttention: "ต้องตรวจสอบ",
    needsAttentionDescription: "เลือกรายการที่ขาดเพื่อดูทริปที่ต้องแก้ไข",
    actualKmNeeded: "ต้องมีระยะทางจากประมาณการ เลขไมล์ GPS หรือเลขไมล์รายสัปดาห์",
    comparePlannedActual: "เปรียบเทียบเส้นทางที่วางแผนกับเส้นทางจริง",
    linkFuelLogsOrManual: "เชื่อมโยงบันทึกน้ำมันหรือกรอกด้วยตนเอง",
    showAllTrips: "แสดงทริปทั้งหมด",
    tripRecords: "รายการทริป",
    tripRecordsDescription: "รายการเดินทางจากการจองแบบย่อ ตรวจสอบแต่ละทริปเพื่อแก้ไขรายละเอียด",
    newestTripsFirst: "แสดงทริปล่าสุดก่อน",
    loadingTripJourneys: "กำลังโหลดทริป...",
    noTripRecordsYet: "ยังไม่มีรายการทริป",
    noTripRecordsDescription: "สร้างทริปจากสมุดบันทึกการจองเพื่อเริ่มติดตามประสิทธิภาพ",
    selectedTrip: "ทริปที่เลือก",
    reviewEdit: "ตรวจสอบ / แก้ไข",
    delete: "ลบ",
    deleteTrip: "ลบทริป",
    needsAttentionAction: "ต้องตรวจสอบ",
    loadMoreTrips: "โหลดทริปเพิ่มเติม",
    selectedTripOverview: "ภาพรวมทริปที่เลือก",
    driver: "พนักงานขับรถ",
    vehicle: "รถ",
    fuelLogs: "เหตุการณ์เติมน้ำมัน",
    noneLinked: "ยังไม่เชื่อมโยง",
    linked: "เชื่อมโยง",
    noFuel: "ไม่มีข้อมูลน้ำมัน",
    noFuelCost: "ไม่มีค่าน้ำมัน",
    nextAction: "สิ่งที่ต้องทำต่อ",
    manageFuelLogs: "จัดการบันทึกน้ำมัน",
    backToTripList: "กลับไปรายการทริป",
    overview: "ภาพรวม",
    journeyDetails: "รายละเอียดการเดินทาง",
    notes: "หมายเหตุ",
    date: "วันที่",
    pickupTime: "เวลารับสินค้า",
    bookingRef: "เลขอ้างอิงการจอง",
    bookingInfo: "ข้อมูลการจอง",
    driverVehicle: "พนักงานขับรถและรถ",
    driverVehicleHelper: "ดึงข้อมูลจากหน้าพนักงานขับรถและรถ ยังสามารถพิมพ์เองได้",
    selectOrTypeDriver: "เลือกหรือพิมพ์ชื่อพนักงานขับรถ",
    selectOrTypeVehicle: "เลือกหรือพิมพ์ทะเบียนรถ",
    manualDriverEntry: "กรอกพนักงานขับรถเอง",
    manualVehicleEntry: "กรอกรถเอง",
    routeGoogleMaps: "เส้นทางและ Google Maps",
    routeGoogleMapsHelper: "เลือกจุดเริ่มต้น แล้วคำนวณหรือแก้ไขระยะทางประมาณการ",
    calculateRouteDistance: "คำนวณระยะทางเส้นทาง",
    calculating: "กำลังคำนวณ...",
    startLocationType: "ประเภทจุดเริ่มต้น",
    startsFromDepot: "เริ่มจากคลัง",
    startsFromCustom: "เริ่มจากสถานที่อื่น",
    depotAddress: "ที่อยู่คลัง",
    startLocation: "จุดเริ่มต้น",
    enterStartLocation: "กรอกจุดเริ่มต้น",
    pickupLocation: "สถานที่รับสินค้า",
    dropoffLocation: "สถานที่ส่งสินค้า",
    returnToDepot: "กลับคลัง",
    routePreview: "ตัวอย่างเส้นทาง",
    googleEstimatedKm: "กม. ประมาณการจาก Google",
    googleEstimatedTime: "เวลาโดยประมาณจาก Google",
    routeSource: "แหล่งข้อมูลเส้นทาง",
    manualEstimatedOverride: "แก้ไข กม. ประมาณการเอง",
    manualEstimateHelper: "ใช้เมื่อ Google Maps ไม่พร้อมใช้งานหรือจำเป็นต้องแก้ไขระยะทาง",
    actualDistance: "ระยะทางจริง",
    manualActualKm: "กม. จริงที่แก้ไขเอง",
    startMileage: "เลขไมล์เริ่มต้น",
    endMileage: "เลขไมล์สิ้นสุด",
    estimatedKmShort: "กม. ประมาณการ",
    fuelStatus: "สถานะน้ำมัน",
    saveTrip: "บันทึกทริป",
    saving: "กำลังบันทึก...",
    noUnsavedChanges: "ไม่มีการเปลี่ยนแปลง",
    unsavedChanges: "มีการเปลี่ยนแปลงที่ยังไม่บันทึก",
    tripSavedSuccessfully: "บันทึกทริปสำเร็จ",
    editDoesNotChangeBooking: "การแก้ไขที่นี่จะไม่เปลี่ยนข้อมูลสมุดบันทึกการจองเดิม",
    fuelSummary: "สรุปน้ำมัน",
    fuelSource: "แหล่งข้อมูลน้ำมัน",
    useLinkedFuelLogs: "ใช้บันทึกน้ำมันที่เชื่อมโยง",
    useManualFuelEntry: "กรอกน้ำมันเอง",
    manualLitresUsed: "ลิตรที่ใช้เอง",
    manualFuelCost: "ค่าน้ำมันที่กรอกเอง",
    linkedFuelLogs: "เหตุการณ์เติมน้ำมันใกล้เคียง",
    noFuelLogsLinkedYet: "ยังไม่มีบันทึกน้ำมันที่เชื่อมโยง",
    unlink: "ยกเลิกเชื่อมโยง",
    addSearchFuelLogs: "เพิ่ม / ค้นหาบันทึกน้ำมัน",
    hide: "ซ่อน",
    addFuelLog: "เพิ่มบันทึกน้ำมัน",
    suggestedLogs: "บันทึกที่แนะนำ",
    noSuggestedFuelLogs: "ไม่พบบันทึกน้ำมันที่แนะนำ",
    link: "เชื่อมโยง",
    searchFuelPlaceholder: "ค้นหารถ พนักงานขับ สถานี วันที่",
    noOtherFuelLogs: "ไม่พบบันทึกน้ำมันอื่นที่ยังไม่เชื่อมโยง",
    loadMore: "โหลดเพิ่มเติม",
    waitingIdleNotes: "หมายเหตุการรอ / จอดเดินเบา",
    extraRouteNotes: "หมายเหตุเส้นทางเพิ่มเติม",
    performanceComparison: "การเปรียบเทียบการปฏิบัติการ",
    comparisonDescription: "การเปรียบเทียบพนักงานขับรถและรถใช้ระยะทางของทริปที่เสร็จและการตรวจรอบน้ำมัน ไม่กระจายน้ำมันหนึ่งใบเสร็จเป็นค่าน้ำมันจริงต่อทริป",
    sortBestKmL: "เรียง: ระยะทางใช้งานมากสุด",
    sortLowestCostKm: "เรียง: ส่วนต่างน้อยสุด",
    sortHighestFuelCost: "เรียง: ส่วนต่างมากสุด",
    sortMostActualKm: "เรียง: ระยะทางใช้งานมากที่สุด",
    sortMostCompletedTrips: "เรียง: ทริปเสร็จสิ้นมากที่สุด",
    sortWorstKmL: "เรียง: ต้องตรวจสอบก่อน",
    sortLowestFuelCost: "เรียง: ระยะทางใช้งานน้อยสุด",
    sortLongestTrip: "เรียง: ทริปยาวที่สุด",
    sortShortestTrip: "เรียง: ทริปสั้นที่สุด",
    sortMostAccurate: "เรียง: แม่นยำที่สุด",
    sortLeastAccurate: "เรียง: คลาดเคลื่อนมากที่สุด",
    moreCompletedTripsNeeded: "ต้องมีทริปที่เสร็จสิ้นมากกว่านี้เพื่อเปรียบเทียบให้แม่นยำ",
    reportsSecondary: "การเปรียบเทียบ / รายงาน",
    reportsSecondaryDescription: "ความแม่นยำเส้นทาง แนวโน้ม อันดับคนขับ และการเปรียบเทียบงาน",
    planned: "วางแผนแล้ว",
    inProgress: "กำลังดำเนินการ",
    dataReady: "ข้อมูลพร้อม",
    needsFuelCheck: "ต้องตรวจน้ำมัน",
    needsMileageCheck: "ต้องตรวจเลขไมล์",
    needsReviewStatus: "ต้องตรวจสอบ",
    bookingLinked: "เชื่อมโยงการจองแล้ว",
    bookingNotLinked: "ยังไม่เชื่อมโยงการจอง",
    distanceMatched: "ระยะทางตรงกัน",
    distanceNeedsReview: "ต้องตรวจระยะทาง",
    fuelNotLinked: "ยังไม่เชื่อมโยงน้ำมัน",
    mileageNotVerified: "ยังไม่ยืนยันเลขไมล์",
    fixNow: "แก้ไขตอนนี้",
    linkFuelLogAction: "เชื่อมโยงบันทึกน้ำมัน",
    mileage: "เลขไมล์",
    tripDistanceUsed: "ระยะทางที่ใช้กับทริป",
    fuelLinked: "เชื่อมโยงน้ำมันแล้ว",
    possibleFuelLogFound: "พบบันทึกน้ำมันที่อาจเกี่ยวข้อง",
    reviewLinkFuelLog: "ตรวจและเชื่อมโยงน้ำมัน",
    fuelManuallyConfirmed: "ยืนยันน้ำมันด้วยตนเอง",
    fuelCycleLinked: "เชื่อมโยงรอบน้ำมันแล้ว",
    fuelLogSupportsTrip: "บันทึกน้ำมันนี้ใช้สนับสนุนทริป",
    fuelLogAlreadyLinkedCount: "เชื่อมโยงกับทริปอื่นแล้ว {count} ทริป",
    distanceSinceLastFuelLog: "ระยะทางตั้งแต่เติมน้ำมันครั้งก่อน",
    linkedFuelCycle: "รอบน้ำมันที่เชื่อมโยงแล้ว",
    fuelCycleAvailable: "มีรอบน้ำมันให้ตรวจ",
    fuelCycleVerified: "ยืนยันรอบน้ำมันแล้ว",
    fuelCycleNotCompleteYet: "รอบน้ำมันยังไม่สมบูรณ์",
    fuelCycleDistance: "ระยะทางรอบน้ำมัน",
    linkedTripDistanceInCycle: "ระยะทางทริปที่เชื่อมในรอบ",
    unallocatedDistance: "ระยะทางอื่น / ยังไม่จัดสรร",
    coverage: "ครอบคลุม",
    partialCycleCoverage: "ครอบคลุมบางส่วนของรอบน้ำมัน",
    mileageCheckAvailable: "มีข้อมูลตรวจเลขไมล์",
    mileageCheckPending: "รอตรวจเลขไมล์",
    waitingForNextFuelLog: "รอบันทึกน้ำมันถัดไป",
    needsFuelLogReceiptCheck: "ต้องตรวจใบเสร็จ",
    mileageNeedsReview: "ต้องตรวจเลขไมล์",
    fuelCycleNotVerified: "ยังไม่ยืนยันรอบน้ำมัน",
    manuallyConfirmFuelCheck: "ยืนยันการตรวจน้ำมันด้วยตนเอง",
    manualFuelConfirmationNote: "ตรวจน้ำมันกับเลขไมล์รายสัปดาห์ / รอบน้ำมันแล้ว",
    linkToThisTrip: "เชื่อมโยงกับทริปนี้",
    rejectSuggestion: "ปฏิเสธรายการแนะนำ",
    missingDistance: "ขาดระยะทาง",
    bestKmLDriver: "พนักงานขับรถระยะทางใช้งานสูงสุด",
    lowestCostKmDriver: "พนักงานขับรถแม่นยำที่สุด",
    bestVehicle: "รถระยะทางใช้งานสูงสุด",
    lowestVehicleCostKm: "รถที่แม่นยำที่สุด",
    mostExpensiveTrip: "ตรวจรอบน้ำมัน",
    biggestDistanceDifference: "ส่วนต่างระยะทางมากที่สุด",
    dataQuality: "คุณภาพข้อมูล",
    drivers: "พนักงานขับรถ",
    vehicles: "รถ",
    routes: "เส้นทาง",
    rank: "อันดับ",
    label: "ป้ายกำกับ",
    avgEstKm: "เฉลี่ย กม. ประมาณการ",
    avgActualKm: "เฉลี่ย กม. จริง",
    avgDifference: "ส่วนต่างเฉลี่ย",
    avgFuelCost: "ตรวจรอบน้ำมัน",
    deleteTripQuestion: "ลบทริปนี้?",
    deleteTripDescription: "จะลบเฉพาะรายการทริปนี้ ไม่ลบรายการจองเดิมหรือบันทึกน้ำมัน",
    cancel: "ยกเลิก",
    deleting: "กำลังลบ...",
    reviewPerformance: "ตรวจสอบประสิทธิภาพ",
    addActualKm: "เพิ่ม กม. จริง",
    addEstimate: "เพิ่มระยะทางประมาณการ",
    reviewDetails: "ตรวจสอบรายละเอียด",
    missingMileageHelper: "เพิ่มระยะทางจาก Google/การจอง เลขไมล์ GPS หรือการตรวจเลขไมล์รายสัปดาห์",
    missingEstimateHelper: "กม. ประมาณการช่วยเปรียบเทียบแผนกับระยะจริง",
    missingFuelHelper: "เชื่อมโยงเหตุการณ์เติมน้ำมันใกล้เคียงหรือตรวจรอบน้ำมันของรถคันนี้",
    completedHelper: "ทริปนี้มีข้อมูลเส้นทางและระยะทางแล้ว ตรวจสอบกับเหตุการณ์น้ำมันหรือเลขไมล์รายสัปดาห์เมื่อมีข้อมูล",
    reviewHelper: "ตรวจสอบรายละเอียดทริปและกรอกข้อมูลที่ขาด",
    googleMapsEstimate: "ประมาณการจาก Google Maps",
    manualOverride: "แก้ไขเอง",
    notCalculated: "ยังไม่คำนวณ",
    usingManualActualKm: "ใช้ กม. จริงที่กรอกเอง",
    usingMileageCalculation: "ใช้การคำนวณจากเลขไมล์",
    actualKmMissing: "ยังไม่มี กม. จริง",
    needsMoreData: "ต้องมีข้อมูลเพิ่มเติม",
    limitedData: "ข้อมูลจำกัด",
    good: "ดี",
    bestKmL: "กม./ลิตร ดีที่สุด",
    lowestCostKm: "ค่าใช้จ่าย/กม. ต่ำสุด",
    overEstimate: "เกินประมาณการ",
    highCostKm: "ค่าใช้จ่าย/กม. สูง",
    lowEfficiency: "ประสิทธิภาพต่ำ",
    average: "เฉลี่ย",
    unknownRoute: "ไม่ทราบเส้นทาง",
    depot: "คลัง",
    customStart: "จุดเริ่มต้นอื่น",
    unassigned: "ยังไม่กำหนด",
    missing: "ขาดข้อมูล",
    distance: "ระยะทาง",
    kmL: "กม./ลิตร",
    costKm: "ค่าใช้จ่าย/กม.",
    noFuelManualWarning: "มีบันทึกน้ำมันที่เชื่อมโยงไว้ แต่ทริปนี้ใช้การกรอกน้ำมันด้วยตนเอง",
    unableToLoadTripJourneys: "ไม่สามารถโหลดรายการทริปได้",
    dataQualityNoFuelCost: "บางทริปไม่มีค่าน้ำมันที่ถูกต้อง",
    dataQualityLinkedNoCost: "บันทึกน้ำมันที่เชื่อมโยงบางรายการไม่มีค่าน้ำมัน",
    dataQualityEstimateNoActual: "บางทริปมีระยะประมาณการแต่ไม่มี กม. จริง",
    dataQualityActualNoFuel: "บางทริปมี กม. จริงแต่ไม่มีข้อมูลน้ำมันที่ใช้งาน",
    driverMatched: "จับคู่พนักงานขับรถจากหน้าพนักงานขับรถแล้ว",
    vehicleCanBeTyped: "สามารถเลือกหรือพิมพ์ทะเบียนรถเองได้",
    vehicleUpdatedFromDriver: "อัปเดตรถจากพนักงานขับที่เลือกแล้ว ยังสามารถเปลี่ยนได้",
    manualDriverEntryMessage: "กรอกพนักงานขับรถเอง ยังสามารถเลือกหรือพิมพ์รถได้",
    routeDistanceCalculated: "คำนวณระยะทางเส้นทางแล้ว บันทึกทริปเพื่อจัดเก็บ",
    fuelLogLinked: "เชื่อมโยงบันทึกน้ำมันกับทริปแล้ว",
    fuelLogUnlinked: "ยกเลิกเชื่อมโยงบันทึกน้ำมันแล้ว",
    routeStartRequired: "กรุณากรอกจุดเริ่มต้นก่อนคำนวณระยะทาง",
    routePickupDropoffRequired: "กรุณากรอกสถานที่รับและส่งสินค้าก่อนคำนวณระยะทาง",
    uuidReferenceError: "มีการส่งเลขอ้างอิงการจองหรือบันทึกน้ำมันไปยังช่องฐานข้อมูล UUID โปรดใช้ migration ของ Trip Journey แล้วลองอีกครั้ง",
    unableToCompleteAction: "ไม่สามารถดำเนินการ Trip Journey นี้ได้"
    ,financialTreatment: "การเงิน"
    ,includeInFinancials: "รวมยอดเงินในการคำนวณทางการเงิน"
    ,financialExclusionHelp: "เมื่อปิด ระยะทางและข้อมูลการปฏิบัติงานจะยังคงถูกนับ แต่ยอดเงินของทริปนี้จะไม่รวมในการคำนวณทางการเงิน"
    ,financialAmount: "ยอดเงิน"
    ,financialAmountExcluded: "ไม่รวมยอดเงิน"
    ,financiallyExcluded: "ไม่รวมยอดเงิน"
  }
} as const;

type TripJourneyCopy = { [K in keyof (typeof tripJourneyCopy)["en"]]: string };

const tripJourneyCopyOverrides: Partial<Record<keyof typeof tripJourneyCopy, Partial<TripJourneyCopy>>> = {
  th: {
    actualKmOverride: "แก้ไขกม. ด้วยตนเอง",
    actualKmOverrideHelper: "ไม่บังคับ ใช้เมื่อผู้ดูแลยืนยันระยะทางของทริปด้วยตนเอง",
    actualDistance: "เลขไมล์จริง",
    manualActualKm: "แก้ไขกม. ด้วยตนเอง",
    workingDistance: "กม. ที่ใช้คำนวณ",
    completedTripsLabel: "ทริปที่เสร็จสิ้น",
    verifiedDataCheckedTrips: "ทริปที่ตรวจข้อมูลแล้ว",
    totalWorkingKm: "กม. ใช้งานทั้งหมด",
    verifiedWorkingKm: "กม. ใช้งานที่ตรวจแล้ว",
    comparisonNeedsChecksHelper: "บางทริปที่เสร็จสิ้นยังต้องตรวจน้ำมันหรือเลขไมล์ การเปรียบเทียบที่ยืนยันแล้วใช้เฉพาะทริปที่ตรวจข้อมูลแล้ว",
    comparisonDescription: "การเปรียบเทียบคนขับและรถแยกทริปที่เสร็จสิ้นออกจากทริปที่ตรวจข้อมูลแล้ว ไม่กระจายน้ำมันหนึ่งใบเสร็จเป็นค่าน้ำมันจริงต่อทริป",
    reviewPerformance: "ตรวจข้อมูล",
    distanceSource: "ที่มาระยะทาง",
    sourceGoogleEstimate: "ประมาณการจาก Google",
    sourceManualActualKm: "แก้ไขด้วยตนเอง",
    sourceOdometerVerified: "เลขไมล์จริง",
    sourceNotAvailable: "ไม่มีข้อมูล",
    estimatedVsActual: "เปอร์เซ็นต์ส่วนต่างระยะทาง",
    mileageVerification: "การตรวจเลขไมล์",
    fuelCycleMileageVerified: "ยืนยันเลขไมล์แล้ว",
    fuelCycles: "รอบน้ำมันของรถทั้งหมด",
    fuelCyclesHelper: "อ้างอิงจากเลขไมล์ในรายการเติมน้ำมัน การ์ดทริปแต่ละรายการอาจแสดงรอบน้ำมันของตัวเอง",
    fuelCycleVerified: "ตรวจรอบน้ำมันแล้ว",
    linkedTripDistanceInCycle: "ระยะทางทริปในรอบนี้",
    unallocatedDistance: "การเคลื่อนที่อื่น / ยังไม่จัดสรร",
    coverage: "สัดส่วนจากทริปที่เชื่อมแล้ว",
    mileageCheckAvailable: "ตรวจเลขไมล์เสร็จแล้ว",
    cycleStatus: "สถานะ",
    fuelCycleNormalHelper: "เป็นเรื่องปกติ รอบน้ำมันอาจรวมการวิ่งกลับคลัง งานอื่น หรือทริปที่ยังไม่ได้เชื่อม",
    dataChecked: "ตรวจข้อมูลแล้ว",
    moreCompletedTripsNeeded: "ต้องมีทริปที่เสร็จสิ้นและตรวจสอบแล้วอย่างน้อย 5 ทริปเพื่อเปรียบเทียบให้เชื่อถือได้",
    bestKmLDriver: "คนขับอันดับปัจจุบันตามระยะทางใช้งาน",
    lowestCostKmDriver: "คนขับที่แม่นยำที่สุดในขณะนี้",
    bestVehicle: "รถอันดับปัจจุบันตามระยะทางใช้งาน",
    lowestVehicleCostKm: "รถที่แม่นยำที่สุดในขณะนี้",
    routeGoogleMapsHelper: "ระยะทางจากการจองคือรับของไปส่งของเท่านั้น ส่วน Trip Journey สามารถคำนวณเส้นทางเต็มที่พนักงานขับรถเลือก",
    startsPickupDropoffOnly: "ไม่ใช้คลัง / รับของไปส่งของเท่านั้น",
    bookingEstimate: "ระยะทางจากการจอง",
    bookingEstimateHelper: "รับของไปส่งของเท่านั้น",
    tripJourneyEstimate: "ระยะทาง Trip Journey",
    tripJourneyEstimateHelper: "เส้นทางเต็มตามที่เลือก",
    routeSummary: "สรุปเส้นทาง",
    bookingRouteLabel: "การจอง",
    tripRouteLabel: "เส้นทางทริป",
    pickupDropoffOnly: "รับของ -> ส่งของ เท่านั้น",
    tripMapsEstimate: "ประมาณการเส้นทางทริปจาก Google",
    bookingEstimateFallback: "ใช้ระยะทางจากการจองเป็นสำรอง",
    displayEstimatePriority: "ระยะทางที่แสดงจะใช้ค่าที่แก้ไขเองก่อน จากนั้นใช้ประมาณการ Trip Journey จาก Google และสุดท้ายใช้ระยะทางจากการจอง",
    openInGoogleMaps: "เปิดใน Google Maps",
    routeDistanceCalculated: "คำนวณระยะทางเส้นทางทริปแล้ว บันทึกทริปเพื่อจัดเก็บ",
    routeCalculateFailed: "ไม่สามารถคำนวณระยะทางได้ คุณสามารถกรอก กม. ประมาณการเองแทนได้",
    googleMapsUnavailable: "Google Maps ไม่พร้อมใช้งาน แต่ยังสามารถกรอกสถานที่เองได้",
    googleMapsLocationHelper: "เก็บข้อมูล Google Maps ที่ยืนยันแล้วจากสมุดจองงานไว้ใช้คำนวณเส้นทาง",
    googleVerified: "ยืนยันโดย Google",
    manualUnverified: "กรอกเอง/ยังไม่ยืนยัน",
    manualEntryStillAllowed: "ยังสามารถกรอกสถานที่เต็มด้วยตนเองได้",
    savedLocationApplied: "ใช้สถานที่ที่บันทึกไว้แล้ว",
    previouslyUsedLocation: "สถานที่ที่เคยใช้",
    changeGoogleMapsLocation: "เปลี่ยนตำแหน่ง Google Maps",
    noSavedLocationFound: "ไม่พบสถานที่ที่บันทึกไว้",
    fastestRoute: "เส้นทางที่เร็วที่สุด",
    refreshRoute: "รีเฟรชเส้นทาง",
    trafficAwareEstimate: "ประมาณการตามสภาพการจราจร",
    googleRecommendedRoute: "เส้นทางที่ Google แนะนำ",
    trafficDataUnavailable: "ไม่มีข้อมูลการจราจร",
    currentTrafficEstimate: "ประมาณการจากการจราจรปัจจุบัน",
    plannedTrafficEstimate: "การจราจรตามเวลาออกเดินทาง",
    fallbackRouteUsed: "Google ไม่พบเส้นทางที่ต้องการ ระบบจึงเลือกเส้นทางที่ใช้งานได้ดีที่สุดแทน",
    routeNeedsRefresh: "ข้อมูลเส้นทางเปลี่ยนแล้ว โปรดรีเฟรชประมาณการการจราจร",
    standardDriveWarning: "เส้นทางขับรถมาตรฐาน ยังไม่ได้ตรวจข้อจำกัดรถบรรทุก",
    calculated: "คำนวณแล้ว"
  }
};

type TripFilter = {
  fromDate: string;
  toDate: string;
  driver: string;
  vehicle: string;
  route: string;
  dataStatus: "all" | "missing" | "completed";
  fuelLink: "all" | "linked" | "not_linked";
};

type TripForm = {
  id: string;
  booking_diary_id: string;
  booking_reference: string;
  trip_date: string;
  pickup_time: string;
  start_location_type: "depot" | "custom" | "pickup_only";
  start_location: string;
  depot_address: string;
  route_start_type: "depot" | "custom" | "pickup_only";
  depot_address_used: string;
  custom_start_address: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_display_name: string;
  dropoff_display_name: string;
  pickup_place_id: string;
  dropoff_place_id: string;
  pickup_lat: string;
  pickup_lng: string;
  dropoff_lat: string;
  dropoff_lng: string;
  pickup_location: string;
  dropoff_location: string;
  route: string;
  vehicle_type: string;
  vehicle_reg: string;
  driver: string;
  load_details: string;
  warehouse_no: string;
  booking_notes: string;
  start_mileage: string;
  end_mileage: string;
  manual_actual_km: string;
  return_to_depot: boolean;
  estimated_distance_km: string;
  estimated_duration_minutes: string;
  google_maps_route_url: string;
  google_estimated_km: string;
  google_estimated_minutes: string;
  route_source: string;
  route_distance_meters: string;
  route_duration_seconds: string;
  route_static_duration_seconds: string;
  route_calculated_at: string;
  route_departure_time: string;
  route_preference: string;
  route_label: string;
  route_description: string;
  route_polyline: string;
  route_traffic_aware: boolean | null;
  route_fallback_info: Record<string, unknown> | null;
  booking_estimated_km: string;
  booking_estimated_minutes: string;
  booking_google_maps_route_url: string;
  manual_estimated_distance_km: string;
  manual_litres_used: string;
  manual_fuel_cost: string;
  fuel_source: TripFuelSource;
  waiting_idle_notes: string;
  extra_route_notes: string;
  include_in_financials: boolean;
  original_trip_price: string;
};

function FinancialTreatmentFields({
  copy,
  form,
  onChange,
  onSave,
  saving
}: {
  copy: TripJourneyCopy;
  form: TripForm;
  onChange: (field: keyof TripForm, value: string | boolean) => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm" aria-labelledby="trip-financial-treatment-title">
      <h4 id="trip-financial-treatment-title" className="text-sm font-extrabold uppercase tracking-[0.12em] text-slate-950">{copy.financialTreatment}</h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="form-field">
          <label className="form-label" htmlFor="trip-original-price">{copy.financialAmount}</label>
          <input id="trip-original-price" type="number" min="0" step="0.01" inputMode="decimal" value={form.original_trip_price} onChange={(event) => onChange("original_trip_price", event.target.value)} className="form-input bg-white" />
        </div>
        <div>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={form.include_in_financials} onChange={(event) => onChange("include_in_financials", event.target.checked)} className="h-4 w-4" />
            {copy.includeInFinancials}
          </label>
          {!form.include_in_financials ? <p className="mt-2 text-sm font-semibold text-slate-700">{copy.financialAmountExcluded}</p> : null}
        </div>
        <p className="text-sm text-slate-600 sm:col-span-2">{copy.financialExclusionHelp}</p>
      </div>
      {onSave ? <button type="button" onClick={onSave} disabled={saving} className="btn-primary mt-3 gap-2"><Save className="h-4 w-4" />{saving ? copy.saving : copy.saveTrip}</button> : null}
    </section>
  );
}

type SelectedTripTab = "overview" | "journey" | "fuel" | "notes";
type ReviewStep = 1 | 2 | 3;
type AttentionFilter = "all" | "missing_mileage" | "missing_estimate" | "missing_fuel" | "missing_weekly_mileage";
type DerivedTripStatus = "completed" | "missing_mileage" | "missing_estimated_distance" | "missing_fuel";
type TripJobStatus = "planned" | "in_progress" | "completed";
type TripDataStatus = "data_ready" | "needs_fuel_check" | "needs_mileage_check" | "missing_estimate" | "missing_distance" | "needs_review";
type FuelReviewStatus = "linked" | "possible" | "manual" | "cycle" | "not_linked";
type ComparisonTab = "drivers" | "vehicles" | "routes" | "trips";
type ComparisonSort =
  | "best_kml"
  | "worst_kml"
  | "lowest_cost_per_km"
  | "highest_fuel_cost"
  | "lowest_fuel_cost"
  | "most_actual_km"
  | "least_actual_km"
  | "most_completed_trips"
  | "most_accurate"
  | "least_accurate";

type PerformanceRow = {
  name: string;
  trips: TripJourneyWithFuel[];
  completedTrips: number;
  verifiedTrips: number;
  totalWorkingKm: number;
  verifiedWorkingKm: number;
  actualKm: number;
  estimatedKm: number;
  litres: number;
  cost: number;
  kmPerLitre: number | null;
  costPerKm: number | null;
  averageDifferenceKm: number | null;
  performanceLabel: string;
};

type RoutePerformanceRow = PerformanceRow & {
  route: string;
  averageActualKm: number | null;
  averageEstimatedKm: number | null;
  averageFuelCost: number | null;
};

type TripComparisonRow = {
  trip: TripJourneyWithFuel;
  metrics: ReturnType<typeof getTripMetrics>;
  status: DerivedTripStatus;
  label: string;
};

type DistanceEstimateResponse = TrafficAwareRouteEstimate;

type DeleteTarget = {
  id: string;
  label: string;
} | null;

const emptyFilters: TripFilter = {
  fromDate: "",
  toDate: "",
  driver: "",
  vehicle: "",
  route: "",
  dataStatus: "all",
  fuelLink: "all"
};

function toNumber(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return null;
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number | null | undefined, decimals = 0) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  }).format(value);
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekStart(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function getTripCompletionPercent(trip: TripJourneyWithFuel) {
  const metrics = getTripMetrics(trip);
  const checks = [
    (metrics.workingDistance ?? 0) > 0,
    (metrics.estimatedDistance ?? 0) > 0,
    hasFuelEvent(trip)
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function getScoreTone(score: number) {
  if (score >= 85) return "green";
  if (score >= 65) return "amber";
  return "rose";
}

function getScoreClass(score: number) {
  const tone = getScoreTone(score);
  if (tone === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function getTrendPolyline(values: number[]) {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const width = 220;
  const height = 54;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function normalizeLookup(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "-";
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

function getEstimateSourceLabel(values: {
  estimated_distance_km?: number | string | null;
  google_estimated_km?: number | string | null;
  booking_estimated_km?: number | string | null;
  manual_estimated_distance_km?: number | string | null;
}, copy: TripJourneyCopy = tripJourneyCopy.en) {
  const manual = toNumber(values.manual_estimated_distance_km);
  const google = toNumber(values.google_estimated_km ?? values.estimated_distance_km);
  const booking = toNumber(values.booking_estimated_km);
  if (manual != null && manual > 0) return copy.manualOverride;
  if (google != null && google > 0) return copy.tripMapsEstimate;
  if (booking != null && booking > 0) return copy.bookingEstimateFallback;
  return copy.notCalculated;
}

type RouteStartType = "depot" | "custom" | "pickup_only";

function getStartLocationType(trip: Pick<TripJourneyWithFuel, "start_location" | "depot_address" | "start_location_type" | "route_start_type">): RouteStartType {
  if (trip.route_start_type === "pickup_only" || trip.start_location_type === "pickup_only") return "pickup_only";
  if (trip.route_start_type === "custom" || trip.start_location_type === "custom") return "custom";
  if (trip.start_location && !isDepotLocation(trip.start_location)) return "custom";
  return "depot";
}

function getEffectiveEstimatedKm(values: {
  estimated_distance_km?: number | string | null;
  google_estimated_km?: number | string | null;
  booking_estimated_km?: number | string | null;
  manual_estimated_distance_km?: number | string | null;
}) {
  const manual = toNumber(values.manual_estimated_distance_km);
  if (manual != null && manual > 0) return manual;
  const google = toNumber(values.google_estimated_km);
  if (google != null && google > 0) return google;
  const booking = toNumber(values.booking_estimated_km);
  if (booking != null && booking > 0) return booking;
  const legacy = toNumber(values.estimated_distance_km);
  if (legacy != null && legacy > 0) return legacy;
  return null;
}

function tripToForm(trip: TripJourneyWithFuel): TripForm {
  const startLocationType = getStartLocationType(trip);
  const googleEstimatedKm = trip.google_estimated_km?.toString() ?? "";
  const bookingEstimatedKm =
    trip.booking_estimated_km?.toString() ??
    (!trip.google_estimated_km && trip.booking_diary_id && trip.estimated_distance_km != null ? trip.estimated_distance_km.toString() : "");
  const googleEstimatedMinutes = trip.google_estimated_minutes?.toString() ?? "";
  const bookingEstimatedMinutes =
    trip.booking_estimated_minutes?.toString() ??
    (!trip.google_estimated_minutes && trip.booking_diary_id && trip.estimated_duration_minutes != null ? trip.estimated_duration_minutes.toString() : "");
  return {
    id: trip.id,
    booking_diary_id: trip.booking_diary_id ?? trip.booking_id ?? "",
    booking_reference: trip.booking_reference ?? "",
    trip_date: trip.trip_date,
    pickup_time: trip.pickup_time ?? "",
    start_location_type: startLocationType,
    start_location: startLocationType === "pickup_only" ? "" : trip.start_location ?? trip.custom_start_address ?? DEPOT_ADDRESS,
    depot_address: trip.depot_address ?? trip.depot_address_used ?? DEPOT_ADDRESS,
    route_start_type: startLocationType,
    depot_address_used: trip.depot_address_used ?? trip.depot_address ?? DEPOT_ADDRESS,
    custom_start_address: trip.custom_start_address ?? (startLocationType === "custom" ? trip.start_location ?? "" : ""),
    pickup_address: trip.pickup_address ?? trip.pickup_location ?? "",
    dropoff_address: trip.dropoff_address ?? trip.dropoff_location ?? "",
    pickup_display_name: trip.pickup_display_name ?? trip.pickup_location ?? "",
    dropoff_display_name: trip.dropoff_display_name ?? trip.dropoff_location ?? "",
    pickup_place_id: trip.pickup_place_id ?? "",
    dropoff_place_id: trip.dropoff_place_id ?? "",
    pickup_lat: trip.pickup_lat?.toString() ?? "",
    pickup_lng: trip.pickup_lng?.toString() ?? "",
    dropoff_lat: trip.dropoff_lat?.toString() ?? "",
    dropoff_lng: trip.dropoff_lng?.toString() ?? "",
    pickup_location: trip.pickup_address ?? trip.pickup_location ?? "",
    dropoff_location: trip.dropoff_address ?? trip.dropoff_location ?? "",
    route: trip.route ?? "",
    vehicle_type: trip.vehicle_type ?? "",
    vehicle_reg: trip.vehicle_reg ?? "",
    driver: trip.driver ?? "",
    load_details: trip.load_details ?? "",
    warehouse_no: trip.warehouse_no ?? "",
    booking_notes: trip.booking_notes ?? "",
    start_mileage: trip.start_mileage?.toString() ?? "",
    end_mileage: trip.end_mileage?.toString() ?? "",
    manual_actual_km: trip.manual_actual_km?.toString() ?? "",
    return_to_depot: trip.return_to_depot,
    estimated_distance_km: trip.estimated_distance_km?.toString() ?? "",
    estimated_duration_minutes: trip.estimated_duration_minutes?.toString() ?? "",
    google_maps_route_url: trip.google_maps_route_url ?? "",
    google_estimated_km: googleEstimatedKm,
    google_estimated_minutes: googleEstimatedMinutes,
    route_source: trip.route_source ?? trip.estimated_distance_source ?? "",
    route_distance_meters: trip.route_distance_meters?.toString() ?? "",
    route_duration_seconds: trip.route_duration_seconds?.toString() ?? "",
    route_static_duration_seconds: trip.route_static_duration_seconds?.toString() ?? "",
    route_calculated_at: trip.route_calculated_at ?? "",
    route_departure_time: trip.route_departure_time ?? "",
    route_preference: trip.route_preference ?? "",
    route_label: trip.route_label ?? "",
    route_description: trip.route_description ?? "",
    route_polyline: trip.route_polyline ?? "",
    route_traffic_aware: trip.route_traffic_aware ?? null,
    route_fallback_info: trip.route_fallback_info ?? null,
    booking_estimated_km: bookingEstimatedKm,
    booking_estimated_minutes: bookingEstimatedMinutes,
    booking_google_maps_route_url: trip.booking_google_maps_route_url ?? "",
    manual_estimated_distance_km: trip.manual_estimated_distance_km?.toString() ?? "",
    manual_litres_used: trip.manual_litres_used?.toString() ?? "",
    manual_fuel_cost: trip.manual_fuel_cost?.toString() ?? "",
    fuel_source: trip.fuel_source,
    waiting_idle_notes: trip.waiting_idle_notes ?? "",
    extra_route_notes: trip.extra_route_notes ?? ""
    ,include_in_financials: trip.include_in_financials !== false
    ,original_trip_price: trip.original_trip_price?.toString() ?? ""
  };
}

function clearTripRouteSnapshot(form: TripForm): TripForm {
  return {
    ...form,
    estimated_distance_km: "",
    estimated_duration_minutes: "",
    google_estimated_km: "",
    google_estimated_minutes: "",
    google_maps_route_url: "",
    route_source: "",
    route_distance_meters: "",
    route_duration_seconds: "",
    route_static_duration_seconds: "",
    route_calculated_at: "",
    route_departure_time: "",
    route_preference: "",
    route_label: "",
    route_description: "",
    route_polyline: "",
    route_traffic_aware: null,
    route_fallback_info: null
  };
}

function getTripStructuredLocation(form: TripForm, type: "pickup" | "dropoff"): StructuredLocation | null {
  const label = type === "pickup" ? form.pickup_display_name : form.dropoff_display_name;
  const formattedAddress = type === "pickup" ? form.pickup_location : form.dropoff_location;
  const placeId = type === "pickup" ? form.pickup_place_id : form.dropoff_place_id;
  const lat = toNumber(type === "pickup" ? form.pickup_lat : form.dropoff_lat);
  const lng = toNumber(type === "pickup" ? form.pickup_lng : form.dropoff_lng);
  if (!label.trim() && !formattedAddress.trim()) return null;

  return {
    label: label || formattedAddress,
    formatted_address: formattedAddress || label,
    place_id: placeId || null,
    lat: lat ?? Number.NaN,
    lng: lng ?? Number.NaN,
    manual_text: placeId ? undefined : formattedAddress || label,
    verified: Boolean(placeId)
  };
}

function getOdometerActualDistance(trip: Pick<TripJourneyWithFuel, "start_mileage" | "end_mileage" | "actual_distance_km">) {
  if (trip.start_mileage != null && trip.end_mileage != null && trip.end_mileage > trip.start_mileage) {
    return trip.end_mileage - trip.start_mileage;
  }
  if (trip.actual_distance_km != null && trip.actual_distance_km > 0) return trip.actual_distance_km;
  return null;
}

function getManualDistanceOverride(trip: Pick<TripJourneyWithFuel, "manual_actual_km">) {
  return trip.manual_actual_km != null && trip.manual_actual_km > 0 ? trip.manual_actual_km : null;
}

function getActualDistance(trip: Pick<TripJourneyWithFuel, "start_mileage" | "end_mileage" | "manual_actual_km" | "actual_distance_km">) {
  return getManualDistanceOverride(trip) ?? getOdometerActualDistance(trip);
}

function getDistanceSourceLabel(trip: TripJourneyWithFuel, copy: TripJourneyCopy = tripJourneyCopy.en) {
  if (trip.manual_actual_km != null && trip.manual_actual_km > 0) return copy.sourceManualActualKm;
  if (trip.start_mileage != null && trip.end_mileage != null && trip.end_mileage > trip.start_mileage) return copy.sourceOdometerVerified;
  if (trip.actual_distance_km != null && trip.actual_distance_km > 0) return copy.sourceOdometerVerified;
  if (getEstimatedDistance(trip) != null) return copy.sourceGoogleEstimate;
  return copy.sourceNotAvailable;
}

function getEstimatedDistance(trip: Pick<TripJourneyWithFuel, "estimated_distance_km" | "google_estimated_km" | "booking_estimated_km" | "manual_estimated_distance_km">) {
  return getEffectiveEstimatedKm(trip);
}

function getFuelTotals(trip: TripJourneyWithFuel) {
  const linkedLitres = trip.linkedFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const linkedCost = trip.linkedFuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const manualLitres = trip.manual_litres_used ?? null;
  const manualCost = trip.manual_fuel_cost ?? null;

  return {
    linkedLitres,
    linkedCost,
    litres: trip.fuel_source === "manual" ? manualLitres : linkedLitres || null,
    cost: trip.fuel_source === "manual" ? manualCost : linkedCost || null,
    isUsingLinked: trip.fuel_source !== "manual",
    hasDoubleCountRisk:
      trip.linkedFuelLogs.length > 0 &&
      ((manualLitres != null && manualLitres > 0) || (manualCost != null && manualCost > 0))
  };
}

function getTripMetrics(trip: TripJourneyWithFuel) {
  const manualDistance = getManualDistanceOverride(trip);
  const odometerActualDistance = getOdometerActualDistance(trip);
  const actualDistance = odometerActualDistance;
  const estimatedDistance = getEstimatedDistance(trip);
  const workingDistance = manualDistance ?? odometerActualDistance ?? estimatedDistance;
  const fuel = getFuelTotals(trip);
  const differenceKm =
    workingDistance != null && estimatedDistance != null ? workingDistance - estimatedDistance : null;
  const differencePercent =
    differenceKm != null && estimatedDistance != null && estimatedDistance > 0
      ? (differenceKm / estimatedDistance) * 100
      : null;
  const kmPerLitre =
    trip.fuel_source === "manual" && workingDistance != null && fuel.litres != null && fuel.litres > 0 ? workingDistance / fuel.litres : null;
  const costPerKm =
    trip.fuel_source === "manual" && fuel.cost != null && workingDistance != null && workingDistance > 0 ? fuel.cost / workingDistance : null;

  return { actualDistance, manualDistance, odometerActualDistance, estimatedDistance, workingDistance, distanceSource: getDistanceSourceLabel(trip), fuel, differenceKm, differencePercent, kmPerLitre, costPerKm };
}

function hasManualFuelConfirmation(trip: Pick<TripJourneyWithFuel, "fuel_source" | "manual_litres_used" | "manual_fuel_cost" | "extra_route_notes" | "waiting_idle_notes">) {
  if (trip.fuel_source === "manual") {
    const hasManualValues = (trip.manual_litres_used ?? 0) > 0 || (trip.manual_fuel_cost ?? 0) > 0;
    const notes = `${trip.extra_route_notes ?? ""} ${trip.waiting_idle_notes ?? ""}`.toLowerCase();
    return hasManualValues || notes.includes("[fuel checked]") || notes.includes("fuel checked") || notes.includes("ตรวจน้ำมัน");
  }
  return false;
}

function hasValidActiveFuel(trip: TripJourneyWithFuel, _metrics = getTripMetrics(trip)) {
  return trip.linkedFuelLogs.length > 0 || hasManualFuelConfirmation(trip);
}

function getDerivedTripStatus(trip: TripJourneyWithFuel): DerivedTripStatus {
  const metrics = getTripMetrics(trip);
  if ((metrics.workingDistance ?? 0) <= 0) return "missing_mileage";
  return "completed";
}

function isCompletedTrip(trip: TripJourneyWithFuel) {
  return getDerivedTripStatus(trip) === "completed";
}

function hasFuelEvent(trip: TripJourneyWithFuel) {
  return trip.linkedFuelLogs.length > 0 || hasValidActiveFuel(trip);
}

function getDistanceToleranceKm(estimatedKm: number | null | undefined) {
  if (estimatedKm == null || estimatedKm <= 0) return null;
  if (estimatedKm < 10) return 3;
  if (estimatedKm <= 100) return estimatedKm * 0.15;
  return estimatedKm * 0.1;
}

function getDistanceReview(metrics: ReturnType<typeof getTripMetrics>) {
  if ((metrics.estimatedDistance ?? 0) <= 0) return { matched: false, needsReview: true };
  if ((metrics.workingDistance ?? 0) <= 0) return { matched: false, needsReview: true };
  if (metrics.differenceKm == null) return { matched: true, needsReview: false };
  const tolerance = getDistanceToleranceKm(metrics.estimatedDistance);
  if (tolerance == null) return { matched: false, needsReview: true };
  const matched = Math.abs(metrics.differenceKm) <= tolerance;
  return { matched, needsReview: !matched };
}

function getFuelReviewStatus(trip: TripJourneyWithFuel, possibleFuelLogs: FuelLogWithDriver[] = [], fuelCycle: FuelCycle | null = null): FuelReviewStatus {
  if (trip.linkedFuelLogs.length > 0) return fuelCycle ? "cycle" : "linked";
  if (hasManualFuelConfirmation(trip)) return "manual";
  if (possibleFuelLogs.length > 0) return "possible";
  return "not_linked";
}

function getFuelStatusLabel(status: FuelReviewStatus, copy: TripJourneyCopy = tripJourneyCopy.en) {
  if (status === "cycle") return copy.fuelCycleLinked;
  if (status === "linked") return copy.fuelLinked;
  if (status === "manual") return copy.fuelManuallyConfirmed;
  if (status === "possible") return copy.possibleFuelLogFound;
  return copy.fuelNotLinked;
}

function fuelStatusClass(status: FuelReviewStatus) {
  if (status === "linked" || status === "cycle" || status === "manual") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "possible") return "border-yellow-200 bg-yellow-50 text-yellow-800";
  return "border-orange-200 bg-orange-50 text-orange-800";
}

function getTripJobStatus(trip: TripJourneyWithFuel): TripJobStatus {
  const status = String(trip.status ?? "").toLowerCase();
  if (status === "completed" || getActualDistance(trip) != null) return "completed";
  const tripDate = trip.trip_date ? new Date(`${trip.trip_date}T00:00:00`) : null;
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  if (tripDate && !Number.isNaN(tripDate.getTime()) && tripDate <= todayDate) return "in_progress";
  return "planned";
}

function hasWeeklyMileageForTrip(trip: TripJourneyWithFuel, weeklyMileage: WeeklyMileageEntry[]) {
  const tripWeek = getWeekKey(trip.trip_date);
  const vehicle = normalizeVehicleKey(trip.vehicle_reg || trip.vehicle_type || "");
  const driver = normalizeVehicleKey(trip.driver || "");
  return weeklyMileage.some((entry) => {
    if (getWeekKey(entry.week_ending) !== tripWeek) return false;
    const vehicleMatches = vehicle && normalizeVehicleKey(entry.vehicle_reg) === vehicle;
    const driverMatches = driver && normalizeVehicleKey(entry.driver) === driver;
    return vehicleMatches || driverMatches;
  });
}

function getWeeklyMileageCheck(
  trip: TripJourneyWithFuel,
  trips: TripJourneyWithFuel[],
  weeklyMileage: WeeklyMileageEntry[],
  copy: TripJourneyCopy = tripJourneyCopy.en
) {
  const tripWeek = getWeekKey(trip.trip_date);
  const vehicle = normalizeVehicleKey(trip.vehicle_reg || trip.vehicle_type || "");
  if (!tripWeek || !vehicle) return { label: copy.weeklyMileageMissing, tone: "amber" as const, difference: null as number | null };

  const vehicleWeeklyEntries = weeklyMileage
    .filter((entry) => normalizeVehicleKey(entry.vehicle_reg) === vehicle && Number(entry.mileage || 0) > 0)
    .sort((left, right) => getWeekKey(left.week_ending).localeCompare(getWeekKey(right.week_ending)));
  const currentIndex = vehicleWeeklyEntries.findIndex((entry) => getWeekKey(entry.week_ending) === tripWeek);
  const weeklyEntry = currentIndex >= 0 ? vehicleWeeklyEntries[currentIndex] : null;
  const previousEntry = currentIndex > 0 ? vehicleWeeklyEntries[currentIndex - 1] : null;
  if (!weeklyEntry || !previousEntry) {
    return { label: copy.weeklyMileageMissing, tone: "amber" as const, difference: null as number | null };
  }

  const tripKmTotal = trips
    .filter((row) => getWeekKey(row.trip_date) === tripWeek && normalizeVehicleKey(row.vehicle_reg || row.vehicle_type || "") === vehicle)
    .reduce((sum, row) => sum + (getTripMetrics(row).workingDistance ?? 0), 0);
  const weeklyDistance = Number(weeklyEntry.mileage || 0) - Number(previousEntry.mileage || 0);
  if (weeklyDistance <= 0) return { label: copy.weeklyMileageNeedsReview, tone: "amber" as const, difference: null as number | null };
  const difference = weeklyDistance - tripKmTotal;
  const percent = tripKmTotal > 0 ? Math.abs(difference) / tripKmTotal : 1;

  if (percent <= 0.1) return { label: copy.weeklyMileageOk, tone: "green" as const, difference };
  if (percent <= 0.2) return { label: copy.weeklyMileageWarning, tone: "amber" as const, difference };
  return { label: copy.weeklyMileageNeedsReview, tone: "amber" as const, difference };
}

function getOperationalStatus(
  trip: TripJourneyWithFuel,
  weeklyMileage: WeeklyMileageEntry[],
  copy: TripJourneyCopy = tripJourneyCopy.en,
  comparisonTrips: TripJourneyWithFuel[] = [trip]
) {
  const derived = getDerivedTripStatus(trip);
  if (derived === "missing_mileage") return { label: copy.missingMileage, tone: "amber" as const };
  if (derived === "missing_estimated_distance") return { label: copy.missingEstimate, tone: "amber" as const };
  const fuelOk = hasFuelEvent(trip);
  const weeklyCheck = getWeeklyMileageCheck(trip, comparisonTrips, weeklyMileage, copy);
  if (fuelOk && weeklyCheck.label === copy.weeklyMileageOk) return { label: copy.verified, tone: "green" as const };
  if (!fuelOk) return { label: copy.missingFuelTitle, tone: "amber" as const };
  if (weeklyCheck.label === copy.weeklyMileageMissing) return { label: copy.weeklyMileageMissing, tone: "slate" as const };
  return { label: weeklyCheck.label, tone: weeklyCheck.tone };
}

function getTripDataReadiness(
  trip: TripJourneyWithFuel,
  weeklyMileage: WeeklyMileageEntry[],
  copy: TripJourneyCopy = tripJourneyCopy.en,
  comparisonTrips: TripJourneyWithFuel[] = [trip],
  possibleFuelLogs: FuelLogWithDriver[] = [],
  fuelCycle: FuelCycle | null = null
) {
  const metrics = getTripMetrics(trip);
  const bookingLinked = Boolean(trip.booking_id || trip.booking_diary_id || trip.booking_reference);
  const hasEstimate = (metrics.estimatedDistance ?? 0) > 0;
  const hasWorkingDistance = (metrics.workingDistance ?? 0) > 0;
  const fuelOk = hasFuelEvent(trip);
  const weeklyCheck = getWeeklyMileageCheck(trip, comparisonTrips, weeklyMileage, copy);
  const mileageVerifiedByFuelCycle = isFuelCycleMileageVerified(fuelCycle);
  const weeklyOk = weeklyCheck.label === copy.weeklyMileageOk || mileageVerifiedByFuelCycle;
  const distanceReview = getDistanceReview(metrics);
  const issues = {
    booking: !bookingLinked,
    estimate: !hasEstimate,
    fuel: !fuelOk,
    possibleFuel: !fuelOk && possibleFuelLogs.length > 0,
    mileage: !hasWorkingDistance,
    weeklyMileage: !weeklyOk,
    distanceConflict: distanceReview.needsReview && hasEstimate && hasWorkingDistance
  };

  let status: TripDataStatus = "data_ready";
  if (issues.estimate) status = "missing_estimate";
  if (issues.mileage) status = "missing_distance";
  if (issues.fuel || issues.possibleFuel) status = "needs_fuel_check";
  if (issues.weeklyMileage) status = "needs_mileage_check";
  if (issues.booking || issues.distanceConflict || Object.values(issues).filter(Boolean).length > 1) status = "needs_review";

  let label =
    status === "data_ready"
      ? copy.dataReady
      : status === "needs_fuel_check"
        ? copy.needsFuelCheck
        : status === "needs_mileage_check"
          ? copy.needsMileageCheck
          : status === "missing_estimate"
            ? copy.missingEstimate
            : status === "missing_distance"
              ? copy.missingDistance
              : copy.needsReviewStatus;
  const fuelCycleCoverage = getFuelCycleCoverage(fuelCycle, comparisonTrips);
  if (status === "data_ready" && mileageVerifiedByFuelCycle && fuelCycleCoverage?.coveragePercent != null && fuelCycleCoverage.coveragePercent < 100) {
    label = copy.dataChecked;
  }
  const tone: "green" | "amber" | "slate" = status === "data_ready" ? "green" : status === "needs_review" ? "amber" : "amber";

  return { status, label, tone, issues, weeklyCheck, mileageVerifiedByFuelCycle };
}

function getMileageVerificationLabel(
  dataReadiness: ReturnType<typeof getTripDataReadiness>,
  weeklyCheckLabel: string,
  copy: TripJourneyCopy = tripJourneyCopy.en
) {
  if (dataReadiness.issues.weeklyMileage) return weeklyCheckLabel;
  return dataReadiness.mileageVerifiedByFuelCycle ? copy.fuelCycleMileageVerified : copy.weeklyMileageVerified;
}

function normalizeVehicleKey(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function getWeekKey(value: string | null | undefined) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const day = date.getDay();
  const diffToSunday = (7 - day) % 7;
  const weekEnding = new Date(date);
  weekEnding.setDate(date.getDate() + diffToSunday);
  return weekEnding.toISOString().slice(0, 10);
}

type FuelCycle = {
  key: string;
  startFuelLogId: string;
  endFuelLogId: string;
  startFuelLog: FuelLogWithDriver;
  endFuelLog: FuelLogWithDriver;
  driver: string;
  vehicleReg: string;
  startDate: string;
  endDate: string;
  startMileage: number;
  endMileage: number;
  distanceKm: number;
  litres: number;
  cost: number;
  mileageValid: boolean;
  receiptsChecked: boolean;
  kmPerLitre: number | null;
  costPerKm: number | null;
};

function buildFuelCycles(fuelLogs: FuelLogWithDriver[]): FuelCycle[] {
  const groups = new Map<string, FuelLogWithDriver[]>();
  fuelLogs.forEach((log) => {
    const vehicle = normalizeVehicleKey(log.vehicle_reg);
    if (!vehicle || log.mileage == null || Number(log.mileage) <= 0 || Number(log.litres || 0) <= 0) return;
    const key = vehicle;
    groups.set(key, [...(groups.get(key) ?? []), log]);
  });

  const cycles: FuelCycle[] = [];
  groups.forEach((logs, key) => {
    const sorted = [...logs].sort((left, right) => {
      const dateCompare = left.date.localeCompare(right.date);
      if (dateCompare !== 0) return dateCompare;
      return Number(left.mileage || 0) - Number(right.mileage || 0);
    });
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const start = sorted[index];
      const end = sorted[index + 1];
      const startMileage = Number(start.mileage || 0);
      const endMileage = Number(end.mileage || 0);
      const mileageValid = endMileage > startMileage;
      const distanceKm = mileageValid ? endMileage - startMileage : 0;
      const litres = Number(end.litres || 0);
      const cost = Number(end.total_cost || 0);
      cycles.push({
        key: `${key}|${start.id}|${end.id}`,
        startFuelLogId: String(start.id),
        endFuelLogId: String(end.id),
        startFuelLog: start,
        endFuelLog: end,
        driver: end.driver || start.driver || "",
        vehicleReg: end.vehicle_reg || start.vehicle_reg || "",
        startDate: start.date,
        endDate: end.date,
        startMileage,
        endMileage,
        distanceKm,
        litres,
        cost,
        mileageValid,
        receiptsChecked: Boolean(start.receipt_checked) && Boolean(end.receipt_checked),
        kmPerLitre: litres > 0 ? distanceKm / litres : null,
        costPerKm: distanceKm > 0 && cost > 0 ? cost / distanceKm : null
      });
    }
  });
  return cycles;
}

function getFuelCycleForTrip(trip: TripJourneyWithFuel, cycles: FuelCycle[]) {
  const vehicle = normalizeVehicleKey(trip.vehicle_reg || trip.vehicle_type || "");
  return cycles.find((cycle) => {
    if (normalizeVehicleKey(cycle.vehicleReg) !== vehicle) return false;
    return trip.trip_date >= cycle.startDate && trip.trip_date <= cycle.endDate;
  }) ?? null;
}

function isFuelCycleMileageVerified(cycle: FuelCycle | null) {
  return Boolean(cycle && cycle.receiptsChecked && cycle.mileageValid && cycle.distanceKm > 0);
}

function isTripLinkedToFuelCycle(trip: TripJourneyWithFuel, cycle: FuelCycle) {
  const cycleFuelLogIds = new Set([cycle.startFuelLogId, cycle.endFuelLogId]);
  return trip.linkedFuelLogs.some((log) => cycleFuelLogIds.has(String(log.id)));
}

function getFuelCycleCoverage(cycle: FuelCycle | null, trips: TripJourneyWithFuel[]) {
  if (!cycle) {
    return null;
  }

  const linkedTrips = trips.filter((trip) => {
    const sameVehicle = normalizeVehicleKey(trip.vehicle_reg || trip.vehicle_type || "") === normalizeVehicleKey(cycle.vehicleReg);
    if (!sameVehicle) return false;
    if (trip.trip_date < cycle.startDate || trip.trip_date > cycle.endDate) return false;
    return isTripLinkedToFuelCycle(trip, cycle);
  });
  const linkedDistance = linkedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).workingDistance ?? 0), 0);
  const unallocatedDistance = Math.max(cycle.distanceKm - linkedDistance, 0);
  const coveragePercent = cycle.distanceKm > 0 ? Math.min(100, (linkedDistance / cycle.distanceKm) * 100) : null;

  return { linkedTrips, linkedDistance, unallocatedDistance, coveragePercent };
}

function getIncompleteLinkedFuelLog(trip: TripJourneyWithFuel, fuelLogs: FuelLogWithDriver[], cycle: FuelCycle | null) {
  if (cycle || trip.linkedFuelLogs.length === 0) return null;
  const vehicle = normalizeVehicleKey(trip.vehicle_reg || trip.vehicle_type || "");
  const sortedLogs = [...fuelLogs]
    .filter((log) => normalizeVehicleKey(log.vehicle_reg) === vehicle && Number(log.mileage || 0) > 0)
    .sort((left, right) => {
      const dateCompare = left.date.localeCompare(right.date);
      if (dateCompare !== 0) return dateCompare;
      return Number(left.mileage || 0) - Number(right.mileage || 0);
    });

  for (const linkedLog of trip.linkedFuelLogs) {
    if (Number(linkedLog.mileage || 0) <= 0) continue;
    const linkedIndex = sortedLogs.findIndex((log) => String(log.id) === String(linkedLog.id));
    if (linkedIndex >= 0 && linkedIndex === sortedLogs.length - 1) return linkedLog;
  }

  return null;
}

function getFuelCycleVerificationState(
  cycle: FuelCycle | null,
  copy: TripJourneyCopy,
  incompleteLog: FuelLogWithDriver | null = null
) {
  if (!cycle) {
    return incompleteLog
      ? {
          title: copy.fuelCycleNotCompleteYet,
          status: copy.waitingForNextFuelLog,
          tone: "amber" as const,
          pendingNotes: [copy.waitingForNextFuelLog]
        }
      : {
          title: copy.fuelCycleNotVerified,
          status: copy.mileageCheckPending,
          tone: "slate" as const,
          pendingNotes: [copy.waitingForNextFuelLog]
        };
  }

  if (!cycle.mileageValid) {
    return {
      title: copy.fuelCycleAvailable,
      status: copy.mileageNeedsReview,
      tone: "amber" as const,
      pendingNotes: [copy.mileageNeedsReview]
    };
  }

  const pendingNotes = [
    !cycle.startFuelLog.receipt_checked ? `${formatDate(cycle.startFuelLog.date)} ${cycle.startFuelLog.vehicle_reg || ""}: ${copy.needsFuelLogReceiptCheck}` : "",
    !cycle.endFuelLog.receipt_checked ? `${formatDate(cycle.endFuelLog.date)} ${cycle.endFuelLog.vehicle_reg || ""}: ${copy.needsFuelLogReceiptCheck}` : ""
  ].filter(Boolean);

  if (pendingNotes.length > 0) {
    return {
      title: copy.fuelCycleAvailable,
      status: copy.mileageCheckPending,
      tone: "amber" as const,
      pendingNotes
    };
  }

  return {
    title: copy.fuelCycleVerified,
    status: copy.mileageCheckAvailable,
    tone: "green" as const,
    pendingNotes: [] as string[]
  };
}

function getHealthBadgeClass(label: string, copy: TripJourneyCopy = tripJourneyCopy.en) {
  if ([copy.good, copy.bestKmL, copy.lowestCostKm].includes(label)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if ([copy.needsMoreData, copy.limitedData].includes(label)) return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function getStatusAccent(status: string) {
  if (status === "completed") return "border-l-emerald-400 bg-emerald-50/30";
  if (status === "missing_fuel") return "border-l-amber-400 bg-amber-50/40";
  if (status === "missing_mileage" || status === "missing_estimated_distance") return "border-l-orange-400 bg-orange-50/35";
  return "border-l-brand-300 bg-brand-50/20";
}

function metricTileClass(tone: "purple" | "green" | "amber" | "rose" | "slate" = "slate") {
  const tones = {
    purple: "border-brand-100 bg-brand-50/75 text-brand-800",
    green: "border-emerald-100 bg-emerald-50/75 text-emerald-800",
    amber: "border-amber-100 bg-amber-50/80 text-amber-800",
    rose: "border-rose-100 bg-rose-50/75 text-rose-800",
    slate: "border-slate-200 bg-slate-50/90 text-slate-700"
  };
  return `rounded-lg border px-3 py-2 ${tones[tone]}`;
}

function getTripHealthLabel(
  metrics: ReturnType<typeof getTripMetrics>,
  comparison: { averageKmPerLitre: number | null; averageCostPerKm: number | null; completedTrips: number },
  copy: TripJourneyCopy = tripJourneyCopy.en
) {
  void comparison.averageKmPerLitre;
  void comparison.averageCostPerKm;
  if (comparison.completedTrips < 2) return copy.needsMoreData;
  if (metrics.differencePercent != null && Math.abs(metrics.differencePercent) > 20) return copy.needsReview;
  if (metrics.differencePercent != null && Math.abs(metrics.differencePercent) > 10) return copy.overEstimate;
  return copy.good;
}

function getPerformanceLabel(row: Pick<PerformanceRow, "completedTrips" | "verifiedTrips" | "estimatedKm" | "averageDifferenceKm">, copy: TripJourneyCopy = tripJourneyCopy.en) {
  const comparisonTrips = row.verifiedTrips;
  if (comparisonTrips === 0) return copy.needsMoreData;
  if (row.estimatedKm <= 0 || row.averageDifferenceKm == null) return copy.limitedData;
  const percent = Math.abs(row.averageDifferenceKm) / (row.estimatedKm / comparisonTrips);
  if (percent <= 0.1) return copy.good;
  if (percent <= 0.2) return copy.overEstimate;
  return copy.needsReview;
}

function sortPerformanceRows<T extends PerformanceRow>(rows: T[], sort: ComparisonSort) {
  const accuracyValue = (row: PerformanceRow) =>
    row.averageDifferenceKm == null ? Number.POSITIVE_INFINITY : Math.abs(row.averageDifferenceKm);
  const sorted = [...rows];
  if (sort === "lowest_cost_per_km") {
    return sorted.sort((a, b) => accuracyValue(a) - accuracyValue(b));
  }
  if (sort === "worst_kml") {
    return sorted.sort((a, b) => accuracyValue(b) - accuracyValue(a));
  }
  if (sort === "highest_fuel_cost") {
    return sorted.sort((a, b) => accuracyValue(b) - accuracyValue(a));
  }
  if (sort === "lowest_fuel_cost") {
    return sorted.sort((a, b) => a.actualKm - b.actualKm);
  }
  if (sort === "most_actual_km") {
    return sorted.sort((a, b) => b.actualKm - a.actualKm);
  }
  if (sort === "least_actual_km") {
    return sorted.sort((a, b) => a.actualKm - b.actualKm);
  }
  if (sort === "most_completed_trips") {
    return sorted.sort((a, b) => b.completedTrips - a.completedTrips);
  }
  if (sort === "most_accurate") {
    return sorted.sort((a, b) => accuracyValue(a) - accuracyValue(b));
  }
  if (sort === "least_accurate") {
    return sorted.sort((a, b) => accuracyValue(b) - accuracyValue(a));
  }
  return sorted.sort((a, b) => b.actualKm - a.actualKm);
}

function isDepotLocation(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  return normalized.includes("expert express sender") || normalized.includes("happy place");
}

function normalizeRouteLocation(value: string | null | undefined) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "";
  if (isDepotLocation(text)) return "depot";
  return text
    .replace(/,?\s*thailand$/i, "")
    .replace(/,?\s*bangkok\s*\d*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactRouteParts(parts: string[]) {
  return parts.filter(Boolean).filter((part, index, values) => {
    if (index === 0) return true;
    return normalizeRouteLocation(part) !== normalizeRouteLocation(values[index - 1]);
  });
}

function buildMapsDirectionsUrl(
  origin: string,
  destination: string,
  waypoints: string[] = [],
  placeIds: { origin?: string; destination?: string; waypoints?: string[] } = {}
) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("travelmode", "driving");
  if (placeIds.origin) url.searchParams.set("origin_place_id", placeIds.origin.replace(/^places\//, ""));
  if (placeIds.destination) url.searchParams.set("destination_place_id", placeIds.destination.replace(/^places\//, ""));
  if (waypoints.length > 0) {
    url.searchParams.set("waypoints", waypoints.join("|"));
    if (placeIds.waypoints?.length === waypoints.length) {
      url.searchParams.set("waypoint_place_ids", placeIds.waypoints.map((id) => id.replace(/^places\//, "")).join("|"));
    }
  }
  return url.toString();
}

function getTripRoutePlan(form: TripForm) {
  const startType = form.start_location_type;
  const depotAddress = form.depot_address.trim() || DEPOT_ADDRESS;
  const customStart = form.start_location.trim();
  const pickup = form.pickup_location.trim();
  const dropoff = form.dropoff_location.trim();
  const pickupPoint = {
    label: form.pickup_display_name || pickup,
    formatted_address: pickup,
    place_id: form.pickup_place_id || null,
    lat: toNumber(form.pickup_lat),
    lng: toNumber(form.pickup_lng)
  };
  const dropoffPoint = {
    label: form.dropoff_display_name || dropoff,
    formatted_address: dropoff,
    place_id: form.dropoff_place_id || null,
    lat: toNumber(form.dropoff_lat),
    lng: toNumber(form.dropoff_lng)
  };

  if (!pickup || !dropoff) return null;
  if (startType === "custom" && !customStart) return null;

  const origin = startType === "pickup_only" ? pickup : startType === "depot" ? depotAddress : customStart;
  const destination = form.return_to_depot ? depotAddress : dropoff;
  const waypoints =
    startType === "pickup_only"
      ? form.return_to_depot
        ? [dropoff]
        : []
      : form.return_to_depot
        ? [pickup, dropoff]
        : [pickup];
  const originPoint = startType === "pickup_only" ? pickupPoint : origin;
  const destinationPoint = form.return_to_depot ? destination : dropoffPoint;
  const waypointPoints =
    startType === "pickup_only"
      ? form.return_to_depot
        ? [dropoffPoint]
        : []
      : form.return_to_depot
        ? [pickupPoint, dropoffPoint]
        : [pickupPoint];
  const originPlaceId = startType === "pickup_only" ? form.pickup_place_id : "";
  const destinationPlaceId = form.return_to_depot ? "" : form.dropoff_place_id;
  const waypointPlaceIds = waypointPoints.map((point) => typeof point === "string" ? "" : point.place_id || "");

  return {
    startType,
    origin,
    destination,
    waypoints,
    originPoint,
    destinationPoint,
    waypointPoints,
    depotAddress,
    customStart,
    pickup,
    dropoff,
    mapsUrl: buildMapsDirectionsUrl(origin, destination, waypoints, {
      origin: originPlaceId,
      destination: destinationPlaceId,
      waypoints: waypointPlaceIds.every(Boolean) ? waypointPlaceIds : undefined
    })
  };
}

function getRoutePreview(trip: Pick<TripJourneyWithFuel, "start_location" | "pickup_location" | "dropoff_location" | "return_to_depot" | "depot_address" | "start_location_type" | "route_start_type">) {
  const startType = getStartLocationType(trip);
  const start = startType === "pickup_only" ? "" : startType === "depot" ? trip.depot_address || DEPOT_ADDRESS : trip.start_location || "";
  const parts = compactRouteParts([start, trip.pickup_location ?? "", trip.dropoff_location ?? ""]);
  if (trip.return_to_depot && normalizeRouteLocation(parts[parts.length - 1]) !== "depot") {
    parts.push(trip.depot_address || DEPOT_ADDRESS);
  }
  return parts.join(" -> ");
}

function shortenLocation(value: string | null | undefined, copy: TripJourneyCopy = tripJourneyCopy.en) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (isDepotLocation(text)) return copy.depot;
  return text
    .replace(/,?\s*Thailand$/i, "")
    .replace(/,?\s*Bangkok\s*\d*$/i, "")
    .split(",")[0]
    .trim();
}

function getShortRoutePreview(trip: Pick<TripJourneyWithFuel, "start_location" | "pickup_location" | "dropoff_location" | "return_to_depot" | "depot_address" | "start_location_type" | "route_start_type">, copy: TripJourneyCopy = tripJourneyCopy.en) {
  const startType = getStartLocationType(trip);
  const parts = compactRouteParts([
    startType === "pickup_only" ? "" : startType === "depot" ? copy.depot : shortenLocation(trip.start_location, copy) || copy.customStart,
    shortenLocation(trip.pickup_location, copy),
    shortenLocation(trip.dropoff_location, copy)
  ]);
  if (trip.return_to_depot && normalizeRouteLocation(parts[parts.length - 1]) !== "depot") parts.push(copy.depot);
  return parts.join(" -> ");
}

function statusActionText(status: string, copy: TripJourneyCopy = tripJourneyCopy.en) {
  if (status === "completed") return copy.reviewPerformance;
  if (status === "missing_mileage") return copy.addActualKm;
  if (status === "missing_estimated_distance") return copy.addEstimate;
  if (status === "missing_fuel") return copy.manageFuelLogs;
  return copy.reviewDetails;
}

function getNextActionHelper(status: string, copy: TripJourneyCopy = tripJourneyCopy.en) {
  if (status === "missing_mileage") return copy.missingMileageHelper;
  if (status === "missing_estimated_distance") return copy.missingEstimateHelper;
  if (status === "missing_fuel") return copy.missingFuelHelper;
  if (status === "completed") return copy.completedHelper;
  return copy.reviewHelper;
}

function actionTabForStatus(status: string): SelectedTripTab {
  if (status === "missing_fuel") return "fuel";
  if (status === "missing_mileage" || status === "missing_estimated_distance") return "journey";
  return "overview";
}

function getFormMetrics(form: TripForm, linkedFuelLogs: FuelLogWithDriver[], copy: TripJourneyCopy = tripJourneyCopy.en) {
  const startMileage = toNumber(form.start_mileage);
  const endMileage = toNumber(form.end_mileage);
  const manualActualKm = toNumber(form.manual_actual_km);
  const odometerActualDistance = startMileage != null && endMileage != null && endMileage > startMileage ? endMileage - startMileage : null;
  const manualDistance = manualActualKm != null && manualActualKm > 0 ? manualActualKm : null;
  const actualDistance = odometerActualDistance;
  const estimatedDistance = getEffectiveEstimatedKm(form);
  const workingDistance = manualDistance ?? odometerActualDistance ?? estimatedDistance;
  const linkedLitres = linkedFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const linkedCost = linkedFuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const fuelLitres = form.fuel_source === "manual" ? toNumber(form.manual_litres_used) : linkedLitres || null;
  const fuelCost = form.fuel_source === "manual" ? toNumber(form.manual_fuel_cost) : linkedCost || null;
  return {
    actualDistance,
    odometerActualDistance,
    manualDistance,
    estimatedDistance,
    workingDistance,
    differenceKm: workingDistance != null && estimatedDistance != null ? workingDistance - estimatedDistance : null,
    fuelLitres,
    fuelCost,
    kmPerLitre: workingDistance != null && fuelLitres != null && fuelLitres > 0 ? workingDistance / fuelLitres : null,
    costPerKm: workingDistance != null && workingDistance > 0 && fuelCost != null ? fuelCost / workingDistance : null,
    actualSource: manualActualKm != null && manualActualKm > 0
      ? copy.sourceManualActualKm
      : startMileage != null && endMileage != null && endMileage > startMileage
        ? copy.sourceOdometerVerified
        : estimatedDistance != null
          ? copy.sourceGoogleEstimate
          : copy.sourceNotAvailable
  };
}

function statusLabel(status: string, copy: TripJourneyCopy = tripJourneyCopy.en) {
  if (status === "completed") return copy.complete;
  if (status === "missing_mileage") return copy.missingMileageTitle;
  if (status === "missing_fuel") return copy.missingFuelTitle;
  if (status === "missing_estimated_distance") return copy.missingEstimateTitle;
  return copy.created;
}

function statusClass(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "created") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function tripJobStatusLabel(status: TripJobStatus, copy: TripJourneyCopy = tripJourneyCopy.en) {
  if (status === "completed") return copy.completed;
  if (status === "in_progress") return copy.inProgress;
  return copy.planned;
}

function tripJobStatusClass(status: TripJobStatus) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "in_progress") return "border-brand-200 bg-brand-50 text-brand-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function dataStatusClass(status: TripDataStatus) {
  if (status === "data_ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "needs_review") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "needs_fuel_check") return "border-orange-200 bg-orange-50 text-orange-800";
  if (status === "missing_estimate" || status === "missing_distance") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-yellow-200 bg-yellow-50 text-yellow-800";
}

function isFuelLogLinkedToTrip(trip: TripJourneyWithFuel, log: FuelLogWithDriver) {
  return trip.linkedFuelLogs.some((linkedLog) => String(linkedLog.id) === String(log.id));
}

function isSuggestedFuelLog(trip: TripJourneyWithFuel, log: FuelLogWithDriver) {
  if (isFuelLogLinkedToTrip(trip, log)) return false;
  const sameVehicle = trip.vehicle_reg && log.vehicle_reg && normalizeVehicleKey(trip.vehicle_reg) === normalizeVehicleKey(log.vehicle_reg);
  const sameDriver = trip.driver && log.driver && trip.driver.toLowerCase() === log.driver.toLowerCase();
  const tripDate = new Date(`${trip.trip_date}T00:00:00`).getTime();
  const fuelDate = new Date(`${log.date}T00:00:00`).getTime();
  if (!Number.isFinite(tripDate) || !Number.isFinite(fuelDate)) return false;
  const daysApart = Math.abs(tripDate - fuelDate) / (24 * 60 * 60 * 1000);
  return Boolean(daysApart <= 3 && (sameVehicle || sameDriver));
}

function getFuelLogMatchScore(trip: TripJourneyWithFuel, log: FuelLogWithDriver) {
  const sameVehicle = trip.vehicle_reg && log.vehicle_reg && trip.vehicle_reg === log.vehicle_reg ? 100 : 0;
  const sameDriver = trip.driver && log.driver && trip.driver.toLowerCase() === log.driver.toLowerCase() ? 20 : 0;
  const tripDate = new Date(`${trip.trip_date}T00:00:00`).getTime();
  const fuelDate = new Date(`${log.date}T00:00:00`).getTime();
  const daysApart = Number.isFinite(tripDate) && Number.isFinite(fuelDate)
    ? Math.abs(tripDate - fuelDate) / (24 * 60 * 60 * 1000)
    : 999;
  return sameVehicle + sameDriver - daysApart;
}

function getPossibleFuelLogsForTrip(trip: TripJourneyWithFuel, fuelLogs: FuelLogWithDriver[], fuelCycle: FuelCycle | null = null) {
  const cycleFuelLogIds = fuelCycle ? new Set([fuelCycle.startFuelLogId, fuelCycle.endFuelLogId]) : new Set<string>();
  return fuelLogs
    .filter((log) => !cycleFuelLogIds.has(String(log.id)))
    .filter((log) => isSuggestedFuelLog(trip, log))
    .sort((a, b) => getFuelLogMatchScore(trip, b) - getFuelLogMatchScore(trip, a));
}

function getFriendlyTripError(err: unknown, copy: TripJourneyCopy = tripJourneyCopy.en) {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("invalid input syntax for type uuid")) {
    return copy.uuidReferenceError;
  }
  return message || copy.unableToCompleteAction;
}

export default function TripJourneyPage() {
  const { language } = useLanguage();
  const copy = useMemo<TripJourneyCopy>(
    () => ({
      ...tripJourneyCopy.en,
      ...tripJourneyCopy[language],
      ...(tripJourneyCopyOverrides[language] ?? {})
    }),
    [language]
  );
  const manualActualKmRef = useRef<HTMLInputElement | null>(null);
  const manualEstimatedKmRef = useRef<HTMLInputElement | null>(null);
  const automaticTripRouteInputRef = useRef<string | null>(null);
  const [trips, setTrips] = useState<TripJourneyWithFuel[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [weeklyMileage, setWeeklyMileage] = useState<WeeklyMileageEntry[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filters, setFilters] = useState<TripFilter>(emptyFilters);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [form, setForm] = useState<TripForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [calculatingDistance, setCalculatingDistance] = useState(false);
  const [distanceMessage, setDistanceMessage] = useState<string | null>(null);
  const [distanceDurationText, setDistanceDurationText] = useState<string | null>(null);
  const [driverVehicleMessage, setDriverVehicleMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestedTripId, setRequestedTripId] = useState<string | null>(null);
  const [requestedBookingId, setRequestedBookingId] = useState<string | null>(null);
  const [manualFuelSearch, setManualFuelSearch] = useState("");
  const [manualFuelDate, setManualFuelDate] = useState("");
  const [manualFuelExpanded, setManualFuelExpanded] = useState(false);
  const [visibleManualFuelLogCount, setVisibleManualFuelLogCount] = useState(10);
  const [selectedTripTab, setSelectedTripTab] = useState<SelectedTripTab>("overview");
  const [reviewStep, setReviewStep] = useState<ReviewStep>(1);
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("all");
  const [visibleTripCount, setVisibleTripCount] = useState(10);
  const [comparisonTab, setComparisonTab] = useState<ComparisonTab>("drivers");
  const [comparisonSort, setComparisonSort] = useState<ComparisonSort>("best_kml");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pageMode, setPageMode] = useState<"trips" | "results">("trips");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedTripId(params.get("tripId") ?? params.get("trip"));
    setRequestedBookingId(params.get("bookingId") ?? params.get("booking"));
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [tripRows, fuelRows, weeklyRows, driverRows, vehicleRows] = await Promise.all([
        fetchTripJourneys(),
        fetchFuelLogs(),
        fetchWeeklyMileage().catch((mileageError) => {
          console.warn("Trip Journey weekly mileage lookup warning:", mileageError);
          return [] as WeeklyMileageEntry[];
        }),
        fetchDrivers().catch((driverError) => {
          console.warn("Trip Journey driver lookup warning:", driverError);
          return [] as Driver[];
        }),
        fetchVehicles().catch((vehicleError) => {
          console.warn("Trip Journey vehicle lookup warning:", vehicleError);
          return [] as Vehicle[];
        })
      ]);
      let nextTripRows = tripRows;
      let targetTripId = selectedTripId ?? requestedTripId;

      if (!targetTripId && requestedBookingId) {
        const existingTrip = nextTripRows.find(
          (trip) =>
            String(trip.booking_diary_id ?? "") === String(requestedBookingId) ||
            String(trip.booking_id ?? "") === String(requestedBookingId)
        );

        if (existingTrip) {
          targetTripId = existingTrip.id;
        } else {
          const bookingRows = await fetchBookingDiaryEntries();
          const booking = bookingRows.find((row) => String(row.id) === String(requestedBookingId)) ?? null;
          if (booking) {
            const createdTrip = await createTripJourneyFromBooking(booking);
            targetTripId = createdTrip.id;
            nextTripRows = await fetchTripJourneys();
          }
        }
      }

      setTrips(nextTripRows);
      setFuelLogs(fuelRows);
      setWeeklyMileage(weeklyRows);
      setDrivers(driverRows);
      setVehicles(vehicleRows);
      if (targetTripId) {
        const nextSelected = nextTripRows.find((trip) => trip.id === targetTripId) ?? null;
        if (nextSelected && !selectedTripId) {
          setSelectedTripId(nextSelected.id);
          const params = new URLSearchParams(window.location.search);
          if (params.get("tripId") !== nextSelected.id) {
            params.set("tripId", nextSelected.id);
            params.delete("trip");
            window.history.replaceState(null, "", `/trip-journey?${params.toString()}`);
          }
        }
        automaticTripRouteInputRef.current = null;
        setForm(nextSelected ? tripToForm(nextSelected) : null);
      }
    } catch (err) {
      console.error("Trip Journey load error:", err);
      setError(err instanceof Error ? err.message : copy.unableToLoadTripJourneys);
    } finally {
      setLoading(false);
    }
  }, [copy, requestedBookingId, requestedTripId, selectedTripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setVisibleManualFuelLogCount(10);
  }, [manualFuelDate, manualFuelSearch, selectedTripId]);

  useEffect(() => {
    setVisibleTripCount(10);
  }, [attentionFilter, filters]);

  const fuelLogTripCounts = useMemo(
    () =>
      trips.reduce((map, trip) => {
        trip.linkedFuelLogs.forEach((log) => {
          const id = String(log.id);
          map.set(id, (map.get(id) ?? 0) + 1);
        });
        return map;
      }, new Map<string, number>()),
    [trips]
  );
  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripId, trips]
  );
  const fuelCycles = useMemo(() => buildFuelCycles(fuelLogs), [fuelLogs]);
  const selectedTripFuelCycle = useMemo(
    () => (selectedTrip ? getFuelCycleForTrip(selectedTrip, fuelCycles) : null),
    [fuelCycles, selectedTrip]
  );
  const suggestedFuelLogs = useMemo(
    () =>
      selectedTrip
        ? fuelLogs
            .filter((log) => !new Set([selectedTripFuelCycle?.startFuelLogId, selectedTripFuelCycle?.endFuelLogId].filter(Boolean) as string[]).has(String(log.id)))
            .filter((log) => isSuggestedFuelLog(selectedTrip, log))
            .sort((a, b) => getFuelLogMatchScore(selectedTrip, b) - getFuelLogMatchScore(selectedTrip, a))
        : [],
    [fuelLogs, selectedTrip, selectedTripFuelCycle]
  );
  const manualFuelLogMatches = useMemo(() => {
    const query = manualFuelSearch.trim().toLowerCase();
    return fuelLogs
      .filter((log) => !selectedTrip || !isFuelLogLinkedToTrip(selectedTrip, log))
      .filter((log) => !suggestedFuelLogs.some((suggested) => String(suggested.id) === String(log.id)))
      .filter((log) => !manualFuelDate || log.date === manualFuelDate)
      .filter((log) => {
        if (!query) return true;
        return [log.vehicle_reg, log.driver, log.date, log.station, log.location]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => selectedTrip ? getFuelLogMatchScore(selectedTrip, b) - getFuelLogMatchScore(selectedTrip, a) : 0);
  }, [fuelLogs, manualFuelDate, manualFuelSearch, selectedTrip, suggestedFuelLogs]);
  const manualFuelLogOptions = useMemo(
    () => manualFuelLogMatches.slice(0, visibleManualFuelLogCount),
    [manualFuelLogMatches, visibleManualFuelLogCount]
  );

  const baseFilteredTrips = useMemo(() => {
    return trips.filter((trip) => {
      const fuelCycle = getFuelCycleForTrip(trip, fuelCycles);
      const possibleFuelLogs = getPossibleFuelLogsForTrip(trip, fuelLogs, fuelCycle);
      const dataReadiness = getTripDataReadiness(trip, weeklyMileage, copy, trips, possibleFuelLogs, fuelCycle);
      const missing = dataReadiness.status !== "data_ready";
      return (
        (!filters.fromDate || trip.trip_date >= filters.fromDate) &&
        (!filters.toDate || trip.trip_date <= filters.toDate) &&
        (!filters.driver || trip.driver === filters.driver) &&
        (!filters.vehicle || trip.vehicle_reg === filters.vehicle) &&
        (!filters.route || (trip.route ?? "").toLowerCase().includes(filters.route.toLowerCase())) &&
        (filters.dataStatus === "all" || (filters.dataStatus === "missing" ? missing : dataReadiness.status === "data_ready")) &&
        (filters.fuelLink === "all" ||
          (filters.fuelLink === "linked" ? trip.linkedFuelLogs.length > 0 : trip.linkedFuelLogs.length === 0))
      );
    }).sort((a, b) => (b.trip_date || "").localeCompare(a.trip_date || ""));
  }, [copy, filters, fuelCycles, fuelLogs, trips, weeklyMileage]);

  const filteredTrips = useMemo(() => {
    return baseFilteredTrips.filter((trip) => {
      const metrics = getTripMetrics(trip);
      if (attentionFilter === "missing_mileage") return (metrics.workingDistance ?? 0) <= 0;
      if (attentionFilter === "missing_estimate") return (metrics.estimatedDistance ?? 0) <= 0;
      const fuelCycle = getFuelCycleForTrip(trip, fuelCycles);
      if (attentionFilter === "missing_fuel") return !hasValidActiveFuel(trip, metrics) || getPossibleFuelLogsForTrip(trip, fuelLogs, fuelCycle).length > 0;
      if (attentionFilter === "missing_weekly_mileage") return getTripDataReadiness(trip, weeklyMileage, copy, baseFilteredTrips, [], fuelCycle).issues.weeklyMileage;
      return true;
    });
  }, [attentionFilter, baseFilteredTrips, copy, fuelCycles, fuelLogs, weeklyMileage]);

  const visibleTrips = useMemo(
    () => filteredTrips.slice(0, visibleTripCount),
    [filteredTrips, visibleTripCount]
  );

  useEffect(() => {
    if (!selectedTripId) return;
    const selectedIndex = filteredTrips.findIndex((trip) => trip.id === selectedTripId);
    if (selectedIndex >= visibleTripCount) {
      setVisibleTripCount(selectedIndex + 1);
    }
  }, [filteredTrips, selectedTripId, visibleTripCount]);

  useEffect(() => {
    if (!selectedTripId || window.location.hash !== "#trip-records") return;
    window.requestAnimationFrame(() => {
      document.getElementById(`trip-${selectedTripId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
  }, [selectedTripId, visibleTrips]);

  const summary = useMemo(() => {
    const completed = baseFilteredTrips.filter(isCompletedTrip);
    const totalActual = baseFilteredTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).workingDistance ?? 0), 0);
    const totalEstimated = baseFilteredTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).estimatedDistance ?? 0), 0);
    const fuelEventTrips = baseFilteredTrips.filter(hasFuelEvent);
    const fuelCycleTrips = baseFilteredTrips.filter((trip) => getFuelCycleForTrip(trip, fuelCycles));
    const weeklyMileageTrips = baseFilteredTrips.filter((trip) => hasWeeklyMileageForTrip(trip, weeklyMileage) || isFuelCycleMileageVerified(getFuelCycleForTrip(trip, fuelCycles)));
    const readyTrips = baseFilteredTrips.filter((trip) => {
      const fuelCycle = getFuelCycleForTrip(trip, fuelCycles);
      return getTripDataReadiness(trip, weeklyMileage, copy, baseFilteredTrips, getPossibleFuelLogsForTrip(trip, fuelLogs, fuelCycle), fuelCycle).status === "data_ready";
    });
    const totalLitres = fuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
    const totalCost = fuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
    const averageKmPerLitre = null;
    const completedActual = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).workingDistance ?? 0), 0);
    const verifiedWorkingKm = readyTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).workingDistance ?? 0), 0);
    const averageCostPerKm = null;
    const routeAccuracyTrips = completed.filter((trip) => {
      const metrics = getTripMetrics(trip);
      return (metrics.estimatedDistance ?? 0) > 0 && metrics.actualDistance != null;
    });
    const averageDifference =
      routeAccuracyTrips.length > 0
        ? routeAccuracyTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).differenceKm ?? 0), 0) / routeAccuracyTrips.length
        : null;
    const completionPercentage = baseFilteredTrips.length > 0
      ? Math.round((completed.length / baseFilteredTrips.length) * 100)
      : 0;
    const routeAccuracyScore =
      routeAccuracyTrips.length > 0
        ? Math.max(
            0,
            100 -
              routeAccuracyTrips.reduce((sum, trip) => {
                const percent = Math.abs(getTripMetrics(trip).differencePercent ?? 0);
                return sum + Math.min(percent, 100);
              }, 0) /
                routeAccuracyTrips.length
          )
        : 0;

    const buildRows = (getName: (trip: TripJourneyWithFuel) => string): PerformanceRow[] => {
      const rows = Array.from(
        baseFilteredTrips.reduce((map, trip) => {
          const key = getName(trip);
          const current = map.get(key) ?? { name: key, trips: [] as TripJourneyWithFuel[] };
          current.trips.push(trip);
          map.set(key, current);
          return map;
        }, new Map<string, { name: string; trips: TripJourneyWithFuel[] }>())
      ).map(([, row]) => {
        const completedTrips = row.trips.filter(isCompletedTrip);
        const verifiedTrips = completedTrips.filter((trip) => {
          const fuelCycle = getFuelCycleForTrip(trip, fuelCycles);
          return getTripDataReadiness(trip, weeklyMileage, copy, baseFilteredTrips, getPossibleFuelLogsForTrip(trip, fuelLogs, fuelCycle), fuelCycle).status === "data_ready";
        });
        const totalWorkingKm = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).workingDistance ?? 0), 0);
        const verifiedWorkingKm = verifiedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).workingDistance ?? 0), 0);
        const actualKm = verifiedWorkingKm;
        const estimatedKm = verifiedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).estimatedDistance ?? 0), 0);
        const litres = verifiedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.litres ?? 0), 0);
        const cost = verifiedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.cost ?? 0), 0);
        const diff = verifiedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).differenceKm ?? 0), 0);
        return {
          ...row,
          completedTrips: completedTrips.length,
          verifiedTrips: verifiedTrips.length,
          totalWorkingKm,
          verifiedWorkingKm,
          actualKm,
          estimatedKm,
          litres,
          cost,
          kmPerLitre: litres > 0 ? actualKm / litres : null,
          costPerKm: actualKm > 0 ? cost / actualKm : null,
          averageDifferenceKm: verifiedTrips.length ? diff / verifiedTrips.length : null,
          performanceLabel: copy.average
        };
      });
      return rows.map((row) => ({ ...row, performanceLabel: getPerformanceLabel(row, copy) }));
    };

    const driverRows = buildRows((trip) => trip.driver || copy.unassigned);
    const vehicleRows = buildRows((trip) => trip.vehicle_reg || trip.vehicle_type || copy.unassigned);
    const routeRows: RoutePerformanceRow[] = buildRows((trip) => getShortRoutePreview(trip, copy) || trip.route || copy.unknownRoute).map((row) => ({
      ...row,
      route: row.name,
      averageActualKm: row.completedTrips ? row.actualKm / row.completedTrips : null,
      averageEstimatedKm: row.completedTrips ? row.estimatedKm / row.completedTrips : null,
      averageFuelCost: row.completedTrips ? row.cost / row.completedTrips : null,
      performanceLabel: row.verifiedTrips <= 1 ? copy.limitedData : row.performanceLabel
    }));
    const tripRows: TripComparisonRow[] = baseFilteredTrips.map((trip) => {
      const metrics = getTripMetrics(trip);
      const status = getDerivedTripStatus(trip);
      return {
        trip,
        metrics,
        status,
        label: status === "completed"
          ? getTripHealthLabel(metrics, { averageKmPerLitre, averageCostPerKm, completedTrips: completed.length }, copy)
          : statusLabel(status, copy)
      };
    });

    const bestDriverByKmPerLitre = [...driverRows].sort((a, b) => b.actualKm - a.actualKm)[0] ?? null;
    const lowestCostDriver = [...driverRows].sort((a, b) => Math.abs(a.averageDifferenceKm ?? Number.POSITIVE_INFINITY) - Math.abs(b.averageDifferenceKm ?? Number.POSITIVE_INFINITY))[0] ?? null;
    const bestVehicleByKmPerLitre = [...vehicleRows].sort((a, b) => b.actualKm - a.actualKm)[0] ?? null;
    const lowestCostVehicle = [...vehicleRows].sort((a, b) => Math.abs(a.averageDifferenceKm ?? Number.POSITIVE_INFINITY) - Math.abs(b.averageDifferenceKm ?? Number.POSITIVE_INFINITY))[0] ?? null;
    const mostExpensiveTrip = [...tripRows].find((row) => getFuelCycleForTrip(row.trip, fuelCycles)) ?? null;
    const biggestDistanceDifference = [...tripRows].filter((row) => row.metrics.differenceKm != null).sort((a, b) => Math.abs(b.metrics.differenceKm ?? 0) - Math.abs(a.metrics.differenceKm ?? 0))[0] ?? null;
    const accurateRouteRows = [...routeRows].filter((row) => row.averageDifferenceKm != null);
    const mostAccurateRoute = [...accurateRouteRows].sort((a, b) => Math.abs(a.averageDifferenceKm ?? 0) - Math.abs(b.averageDifferenceKm ?? 0))[0] ?? null;
    const leastAccurateRoute = [...accurateRouteRows].sort((a, b) => Math.abs(b.averageDifferenceKm ?? 0) - Math.abs(a.averageDifferenceKm ?? 0))[0] ?? null;
    const largestRouteDifference = leastAccurateRoute?.averageDifferenceKm ?? null;
    const fleetPerformanceScore = Math.round(
      baseFilteredTrips.length > 0
        ? Math.max(
            0,
            Math.min(
              100,
              completionPercentage * 0.55 +
                routeAccuracyScore * 0.25 +
                (readyTrips.length / baseFilteredTrips.length) * 100 * 0.2
            )
          )
        : 0
    );
    const monthMap = new Map<string, { label: string; completed: number; distance: number; litres: number; cost: number; kmL: number | null }>();
    completed.forEach((trip) => {
      const month = (trip.trip_date || "").slice(0, 7) || "Unknown";
      const current = monthMap.get(month) ?? { label: month, completed: 0, distance: 0, litres: 0, cost: 0, kmL: null };
      const metrics = getTripMetrics(trip);
      current.completed += 1;
      current.distance += metrics.workingDistance ?? 0;
      current.litres += 0;
      current.cost += 0;
      current.kmL = null;
      monthMap.set(month, current);
    });
    const monthlyTrends = Array.from(monthMap.values()).sort((a, b) => a.label.localeCompare(b.label)).slice(-6);
    const dataQualityNotes = [
      baseFilteredTrips.some((trip) => (getTripMetrics(trip).workingDistance ?? 0) <= 0) ? copy.dataQualityEstimateNoActual : "",
      baseFilteredTrips.some((trip) => (getTripMetrics(trip).workingDistance ?? 0) > 0 && !hasFuelEvent(trip)) ? copy.dataQualityActualNoFuel : ""
    ].filter(Boolean);

    return {
      totalTrips: baseFilteredTrips.length,
      completedTrips: completed.length,
      inProgressTrips: baseFilteredTrips.length - completed.length,
      completionPercentage,
      fleetPerformanceScore,
      routeAccuracyScore,
      missingDataTrips: baseFilteredTrips.filter((trip) => !isCompletedTrip(trip)).length,
      missingMileage: baseFilteredTrips.filter((trip) => (getTripMetrics(trip).workingDistance ?? 0) <= 0).length,
      missingEstimate: baseFilteredTrips.filter((trip) => (getTripMetrics(trip).estimatedDistance ?? 0) <= 0).length,
      missingFuel: baseFilteredTrips.filter((trip) => {
        const fuelCycle = getFuelCycleForTrip(trip, fuelCycles);
        return !hasFuelEvent(trip) || getPossibleFuelLogsForTrip(trip, fuelLogs, fuelCycle).length > 0;
      }).length,
      missingWeeklyMileage: baseFilteredTrips.filter((trip) => getTripDataReadiness(trip, weeklyMileage, copy, baseFilteredTrips, [], getFuelCycleForTrip(trip, fuelCycles)).issues.weeklyMileage).length,
      fuelEventTrips: fuelEventTrips.length,
      fuelCycles: fuelCycles.length,
      fuelCycleTrips: fuelCycleTrips.length,
      weeklyMileageTrips: weeklyMileageTrips.length,
      verifiedTrips: readyTrips.length,
      completedWorkingKm: completedActual,
      verifiedWorkingKm,
      totalActual,
      totalEstimated,
      totalLitres,
      totalCost,
      averageKmPerLitre,
      averageCostPerKm,
      averageDifference,
      bestDriver: bestDriverByKmPerLitre?.name ?? "-",
      worstDriver: [...driverRows].sort((a, b) => Math.abs(b.averageDifferenceKm ?? 0) - Math.abs(a.averageDifferenceKm ?? 0))[0]?.name ?? "-",
      driverRows,
      vehicleRows,
      routeRows,
      tripRows,
      bestDriverByKmPerLitre,
      lowestCostDriver,
      bestVehicleByKmPerLitre,
      lowestCostVehicle,
      mostExpensiveTrip,
      biggestDistanceDifference,
      mostAccurateRoute,
      leastAccurateRoute,
      largestRouteDifference,
      monthlyTrends,
      dataQualityNotes
    };
  }, [baseFilteredTrips, copy, fuelCycles, fuelLogs, weeklyMileage]);


  const operationalCounts = useMemo(() => {
    let needsAttention = 0;
    let missingFuel = 0;
    let missingMileage = 0;
    let missingEstimate = 0;
    let readyToVerify = 0;
    let verified = 0;

    baseFilteredTrips.forEach((trip) => {
      const fuelCycle = getFuelCycleForTrip(trip, fuelCycles);
      const possibleFuelLogs = getPossibleFuelLogsForTrip(trip, fuelLogs, fuelCycle);
      const readiness = getTripDataReadiness(
        trip,
        weeklyMileage,
        copy,
        baseFilteredTrips,
        possibleFuelLogs,
        fuelCycle
      );

      if (readiness.status === "data_ready") {
        verified += 1;
        return;
      }

      needsAttention += 1;
      if (readiness.issues.fuel) missingFuel += 1;
      if (readiness.issues.weeklyMileage) missingMileage += 1;
      if ((getTripMetrics(trip).estimatedDistance ?? 0) <= 0) missingEstimate += 1;

      if (
        isCompletedTrip(trip) &&
        !readiness.issues.fuel &&
        !readiness.issues.weeklyMileage &&
        (getTripMetrics(trip).workingDistance ?? 0) > 0
      ) {
        readyToVerify += 1;
      }
    });

    return {
      needsAttention,
      missingFuel,
      missingMileage,
      missingEstimate,
      readyToVerify,
      verified
    };
  }, [baseFilteredTrips, copy, fuelCycles, fuelLogs, weeklyMileage]);

  const resultsData = useMemo(() => {
    const verifiedTrips = baseFilteredTrips.filter((trip) => {
      const fuelCycle = getFuelCycleForTrip(trip, fuelCycles);
      const possibleFuelLogs = getPossibleFuelLogsForTrip(trip, fuelLogs, fuelCycle);
      return getTripDataReadiness(
        trip,
        weeklyMileage,
        copy,
        baseFilteredTrips,
        possibleFuelLogs,
        fuelCycle
      ).status === "data_ready";
    });

    const totalPlannedKm = verifiedTrips.reduce(
      (sum, trip) => sum + (getTripMetrics(trip).estimatedDistance ?? 0),
      0
    );
    const totalWorkingKm = verifiedTrips.reduce(
      (sum, trip) => sum + (getTripMetrics(trip).workingDistance ?? 0),
      0
    );
    const totalDifferenceKm = totalWorkingKm - totalPlannedKm;
    const averageVariancePercent =
      verifiedTrips.length > 0
        ? verifiedTrips.reduce((sum, trip) => {
            const metrics = getTripMetrics(trip);
            return sum + Math.abs(metrics.differencePercent ?? 0);
          }, 0) / verifiedTrips.length
        : null;

    const routeMap = verifiedTrips.reduce((map, trip) => {
      const bookingRoute =
        [shortenLocation(trip.pickup_location, copy), shortenLocation(trip.dropoff_location, copy)]
          .filter(Boolean)
          .join(" -> ");
      const route = bookingRoute || trip.route || copy.unknownRoute;
      const current = map.get(route) ?? {
        route,
        trips: 0,
        plannedKm: 0,
        workingKm: 0,
        differenceKm: 0
      };
      const metrics = getTripMetrics(trip);
      current.trips += 1;
      current.plannedKm += metrics.estimatedDistance ?? 0;
      current.workingKm += metrics.workingDistance ?? 0;
      current.differenceKm += metrics.differenceKm ?? 0;
      map.set(route, current);
      return map;
    }, new Map<string, { route: string; trips: number; plannedKm: number; workingKm: number; differenceKm: number }>());

    const routes = Array.from(routeMap.values())
      .map((row) => ({
        ...row,
        averagePlannedKm: row.trips ? row.plannedKm / row.trips : null,
        averageWorkingKm: row.trips ? row.workingKm / row.trips : null,
        averageDifferenceKm: row.trips ? row.differenceKm / row.trips : null,
        averageDifferencePercent:
          row.plannedKm > 0 ? ((row.workingKm - row.plannedKm) / row.plannedKm) * 100 : null
      }))
      .sort((a, b) => b.trips - a.trips || Math.abs(b.averageDifferenceKm ?? 0) - Math.abs(a.averageDifferenceKm ?? 0));

    const buildComparableRows = (getName: (trip: TripJourneyWithFuel) => string) => {
      const map = verifiedTrips.reduce((acc, trip) => {
        const name = getName(trip) || copy.unassigned;
        const current = acc.get(name) ?? {
          name,
          trips: 0,
          plannedKm: 0,
          workingKm: 0,
          absoluteVarianceKm: 0
        };
        const metrics = getTripMetrics(trip);
        current.trips += 1;
        current.plannedKm += metrics.estimatedDistance ?? 0;
        current.workingKm += metrics.workingDistance ?? 0;
        current.absoluteVarianceKm += Math.abs(metrics.differenceKm ?? 0);
        acc.set(name, current);
        return acc;
      }, new Map<string, { name: string; trips: number; plannedKm: number; workingKm: number; absoluteVarianceKm: number }>());

      return Array.from(map.values())
        .map((row) => ({
          ...row,
          averageDifferenceKm: row.trips ? row.absoluteVarianceKm / row.trips : null
        }))
        .sort((a, b) => b.trips - a.trips || (a.averageDifferenceKm ?? 0) - (b.averageDifferenceKm ?? 0));
    };

    const drivers = buildComparableRows((trip) => trip.driver || copy.unassigned);
    const vehicles = buildComparableRows((trip) => trip.vehicle_reg || trip.vehicle_type || copy.unassigned);

    const relevantFuelCycles = fuelCycles.filter((cycle) =>
      verifiedTrips.some((trip) => {
        const sameVehicle =
          normalizeVehicleKey(trip.vehicle_reg || trip.vehicle_type || "") ===
          normalizeVehicleKey(cycle.vehicleReg);
        return sameVehicle && trip.trip_date >= cycle.startDate && trip.trip_date <= cycle.endDate;
      })
    );

    const cycleCoverageRows = relevantFuelCycles
      .map((cycle) => getFuelCycleCoverage(cycle, verifiedTrips))
      .filter((coverage) => coverage?.coveragePercent != null);
    const totalLinkedTripKm = cycleCoverageRows.reduce(
      (sum, coverage) => sum + Math.max(0, Number(coverage?.linkedDistance ?? 0)),
      0
    );
    const totalUnallocatedKm = cycleCoverageRows.reduce(
      (sum, coverage) => sum + Math.max(0, Number(coverage?.unallocatedDistance ?? 0)),
      0
    );
    const totalRelevantFuelCycleKm = totalLinkedTripKm + totalUnallocatedKm;
    const averageFuelCycleCoverage =
      totalRelevantFuelCycleKm > 0
        ? Math.min(100, (totalLinkedTripKm / totalRelevantFuelCycleKm) * 100)
        : null;

    return {
      verifiedTrips,
      totalPlannedKm,
      totalWorkingKm,
      totalDifferenceKm,
      averageVariancePercent,
      routes,
      repeatRoutes: routes.filter((route) => route.trips >= 2),
      drivers,
      vehicles,
      averageFuelCycleCoverage,
      totalLinkedTripKm,
      totalRelevantFuelCycleKm,
      totalUnallocatedKm
    };
  }, [baseFilteredTrips, copy, fuelCycles, fuelLogs, weeklyMileage]);

  const sortedDriverRows = useMemo(() => sortPerformanceRows(summary.driverRows, comparisonSort), [comparisonSort, summary.driverRows]);
  const sortedVehicleRows = useMemo(() => sortPerformanceRows(summary.vehicleRows, comparisonSort), [comparisonSort, summary.vehicleRows]);
  const sortedRouteRows = useMemo(() => sortPerformanceRows(summary.routeRows, comparisonSort), [comparisonSort, summary.routeRows]);
  const topDriverRows = useMemo(
    () =>
      sortPerformanceRows(summary.driverRows, "best_kml").slice(0, 5).map((row) => {
        const vehicleCounts = row.trips.reduce((map, trip) => {
          const key = trip.vehicle_reg || trip.vehicle_type || "-";
          map.set(key, (map.get(key) ?? 0) + 1);
          return map;
        }, new Map<string, number>());
        const vehicle = Array.from(vehicleCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
        return { ...row, vehicle };
      }),
    [summary.driverRows]
  );
  const sortedTripRows = useMemo(() => {
    return [...summary.tripRows].sort((a, b) => {
      if (comparisonSort === "lowest_cost_per_km") return Math.abs(a.metrics.differenceKm ?? Number.POSITIVE_INFINITY) - Math.abs(b.metrics.differenceKm ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "worst_kml") return Math.abs(b.metrics.differenceKm ?? 0) - Math.abs(a.metrics.differenceKm ?? 0);
      if (comparisonSort === "highest_fuel_cost") return Math.abs(b.metrics.differenceKm ?? 0) - Math.abs(a.metrics.differenceKm ?? 0);
      if (comparisonSort === "lowest_fuel_cost") return (a.metrics.workingDistance ?? Number.POSITIVE_INFINITY) - (b.metrics.workingDistance ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "most_actual_km") return (b.metrics.workingDistance ?? 0) - (a.metrics.workingDistance ?? 0);
      if (comparisonSort === "least_actual_km") return (a.metrics.workingDistance ?? Number.POSITIVE_INFINITY) - (b.metrics.workingDistance ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "most_completed_trips") return a.status === b.status ? 0 : a.status === "completed" ? -1 : 1;
      if (comparisonSort === "most_accurate") return Math.abs(a.metrics.differenceKm ?? Number.POSITIVE_INFINITY) - Math.abs(b.metrics.differenceKm ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "least_accurate") return Math.abs(b.metrics.differenceKm ?? 0) - Math.abs(a.metrics.differenceKm ?? 0);
      return (b.metrics.workingDistance ?? 0) - (a.metrics.workingDistance ?? 0);
    });
  }, [comparisonSort, summary.tripRows]);

  const driverOptions = useMemo(
    () => Array.from(new Set(trips.map((trip) => trip.driver).filter(Boolean))).sort() as string[],
    [trips]
  );
  const vehicleOptions = useMemo(
    () => Array.from(new Set(trips.map((trip) => trip.vehicle_reg).filter(Boolean))).sort() as string[],
    [trips]
  );
  const selectedFormMetrics = form ? getFormMetrics(form, selectedTrip?.linkedFuelLogs ?? [], copy) : null;
  const selectedTripStatus = selectedTrip ? getDerivedTripStatus(selectedTrip) : null;
  const driverDatalistOptions = useMemo(() => {
    const values = new Set<string>();
    drivers.forEach((driver) => {
      if (driver.name) values.add(driver.name);
    });
    trips.forEach((trip) => {
      if (trip.driver) values.add(trip.driver);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [drivers, trips]);
  const vehicleDatalistOptions = useMemo(() => {
    const values = new Set<string>();
    vehicles.forEach((vehicle) => {
      const registration = vehicle.vehicle_reg || vehicle.registration;
      if (registration) values.add(registration);
    });
    drivers.forEach((driver) => {
      if (driver.vehicle_reg) values.add(driver.vehicle_reg);
    });
    trips.forEach((trip) => {
      if (trip.vehicle_reg) values.add(trip.vehicle_reg);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [drivers, trips, vehicles]);
  const selectedEstimateSource = form
    ? getEstimateSourceLabel({
        estimated_distance_km: form.estimated_distance_km,
        google_estimated_km: form.google_estimated_km,
        booking_estimated_km: form.booking_estimated_km,
        manual_estimated_distance_km: form.manual_estimated_distance_km
      }, copy)
    : copy.notCalculated;
  const currentRoutePlan = form ? getTripRoutePlan(form) : null;
  const currentGoogleMapsUrl = currentRoutePlan?.mapsUrl || form?.google_maps_route_url || "";
  const bookingEstimateKm = form ? toNumber(form.booking_estimated_km) : null;
  const bookingEstimateMinutes = form ? toNumber(form.booking_estimated_minutes) : null;
  const tripGoogleEstimateKm = form ? toNumber(form.google_estimated_km) : null;
  const tripGoogleEstimateMinutes = form ? toNumber(form.google_estimated_minutes) : null;

  const openTrip = (trip: TripJourneyWithFuel) => {
    automaticTripRouteInputRef.current = null;
    setSelectedTripId(trip.id);
    setForm(tripToForm(trip));
    setHasUnsavedChanges(false);
    setSelectedTripTab("overview");
    setReviewStep(1);
    setManualFuelExpanded(false);
    setDistanceMessage(null);
    setDistanceDurationText(trip.google_estimated_minutes ? formatDuration(trip.google_estimated_minutes * 60) : null);
    setDriverVehicleMessage(null);
    setNotice(null);
    setError(null);
    const params = new URLSearchParams(window.location.search);
    params.set("tripId", trip.id);
    params.delete("trip");
    window.history.replaceState(null, "", `/trip-journey?${params.toString()}`);
  };

  const closeTripReview = () => {
    // Clear BOTH the selected trip and any trip/booking request that originally
    // opened the review. Otherwise load() sees the old requestedTripId and
    // immediately re-opens the modal after the X button is pressed.
    setSelectedTripId(null);
    setRequestedTripId(null);
    setRequestedBookingId(null);
    setForm(null);
    setHasUnsavedChanges(false);
    setManualFuelExpanded(false);
    setReviewStep(1);
    setNotice(null);
    setError(null);

    const params = new URLSearchParams(window.location.search);
    params.delete("tripId");
    params.delete("trip");
    params.delete("bookingId");
    params.delete("booking");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/trip-journey?${query}` : "/trip-journey");
  };

  const applyQuickFilter = (filter: "today" | "yesterday" | "week" | "month" | "missing_mileage" | "missing_fuel" | "completed") => {
    const now = new Date();
    setVisibleTripCount(10);
    if (filter === "today") {
      const date = toDateKey(now);
      setFilters((current) => ({ ...current, fromDate: date, toDate: date, dataStatus: "all" }));
      setAttentionFilter("all");
      return;
    }
    if (filter === "yesterday") {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const date = toDateKey(yesterday);
      setFilters((current) => ({ ...current, fromDate: date, toDate: date, dataStatus: "all" }));
      setAttentionFilter("all");
      return;
    }
    if (filter === "week") {
      setFilters((current) => ({ ...current, fromDate: toDateKey(getWeekStart(now)), toDate: toDateKey(now), dataStatus: "all" }));
      setAttentionFilter("all");
      return;
    }
    if (filter === "month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setFilters((current) => ({ ...current, fromDate: toDateKey(firstDay), toDate: toDateKey(now), dataStatus: "all" }));
      setAttentionFilter("all");
      return;
    }
    if (filter === "completed") {
      setFilters((current) => ({ ...current, dataStatus: "completed" }));
      setAttentionFilter("all");
      return;
    }
    setFilters((current) => ({ ...current, dataStatus: "all" }));
    setAttentionFilter(filter);
  };

  const updateForm = (field: keyof TripForm, value: string | boolean) => {
    setHasUnsavedChanges(true);
    const routeInputChanged = ["trip_date", "pickup_time", "start_location", "depot_address", "return_to_depot"].includes(field);
    if (routeInputChanged) {
      setDistanceMessage(copy.routeNeedsRefresh);
      setDistanceDurationText(null);
    }
    setForm((current) => current
      ? { ...(routeInputChanged ? clearTripRouteSnapshot(current) : current), [field]: value }
      : current);
  };

  const updateTripLocationText = (type: "pickup" | "dropoff", value: string) => {
    setHasUnsavedChanges(true);
    setDistanceMessage(copy.routeNeedsRefresh);
    setForm((current) => current
      ? {
          ...clearTripRouteSnapshot(current),
          [`${type}_location`]: value,
          [`${type}_address`]: value,
          [`${type}_place_id`]: "",
          [`${type}_lat`]: "",
          [`${type}_lng`]: ""
        }
      : current);
  };

  const updateTripStructuredLocation = (type: "pickup" | "dropoff", location: StructuredLocation) => {
    setHasUnsavedChanges(true);
    setDistanceMessage(copy.routeNeedsRefresh);
    const address = location.formatted_address || location.label;
    setForm((current) => current
      ? {
          ...clearTripRouteSnapshot(current),
          [`${type}_display_name`]: current[`${type}_display_name`] || location.label,
          [`${type}_location`]: address,
          [`${type}_address`]: address,
          [`${type}_place_id`]: location.place_id ?? "",
          [`${type}_lat`]: Number.isFinite(location.lat) ? String(location.lat) : "",
          [`${type}_lng`]: Number.isFinite(location.lng) ? String(location.lng) : ""
        }
      : current);
  };

  const handleDriverChange = (value: string) => {
    setHasUnsavedChanges(true);
    setForm((current) => {
      if (!current) return current;
      const matchedDriver = drivers.find((driver) => normalizeLookup(driver.name) === normalizeLookup(value));
      if (!matchedDriver?.vehicle_reg) {
        setDriverVehicleMessage(value.trim() ? copy.manualDriverEntryMessage : null);
        return { ...current, driver: value };
      }

      if (normalizeLookup(current.vehicle_reg) === normalizeLookup(matchedDriver.vehicle_reg)) {
        setDriverVehicleMessage(copy.driverMatched);
        return { ...current, driver: value };
      }

      setDriverVehicleMessage(copy.vehicleUpdatedFromDriver);
      return {
        ...current,
        driver: value,
        vehicle_reg: matchedDriver.vehicle_reg,
        vehicle_type: matchedDriver.vehicle_type ?? current.vehicle_type
      };
    });
  };

  const handleVehicleChange = (value: string) => {
    setDriverVehicleMessage(value.trim() ? copy.vehicleCanBeTyped : null);
    updateForm("vehicle_reg", value);
  };

  const handleStartLocationTypeChange = (value: RouteStartType) => {
    setHasUnsavedChanges(true);
    setDistanceMessage(copy.routeNeedsRefresh);
    setDistanceDurationText(null);
    setForm((current) => {
      if (!current) return current;
      const cleared = clearTripRouteSnapshot(current);
      if (value === "depot") {
        return {
          ...cleared,
          start_location_type: "depot",
          route_start_type: "depot",
          depot_address: current.depot_address || DEPOT_ADDRESS,
          depot_address_used: current.depot_address || DEPOT_ADDRESS,
          start_location: current.depot_address || DEPOT_ADDRESS,
          custom_start_address: ""
        };
      }
      if (value === "pickup_only") {
        return {
          ...cleared,
          start_location_type: "pickup_only",
          route_start_type: "pickup_only",
          start_location: "",
          custom_start_address: ""
        };
      }
      return {
        ...cleared,
        start_location_type: "custom",
        route_start_type: "custom",
        start_location: isDepotLocation(current.start_location) ? current.custom_start_address : current.start_location,
        custom_start_address: isDepotLocation(current.start_location) ? current.custom_start_address : current.start_location
      };
    });
  };

  const focusJourneyField = (target: "actual" | "estimate") => {
    setSelectedTripTab("journey");
    window.setTimeout(() => {
      const field = target === "actual" ? manualActualKmRef.current : manualEstimatedKmRef.current;
      field?.focus();
      field?.select();
    }, 80);
  };

  const handlePrimaryTripAction = (status: string) => {
    if (status === "missing_mileage") {
      focusJourneyField("actual");
      return;
    }
    if (status === "missing_estimated_distance") {
      focusJourneyField("estimate");
      return;
    }
    if (status === "missing_fuel") {
      setSelectedTripTab("fuel");
      return;
    }
    setSelectedTripTab(status === "completed" ? "overview" : actionTabForStatus(status));
  };

  const getCurrentRoutePreview = () => {
    if (!form) return "";
    const start =
      form.start_location_type === "pickup_only"
        ? ""
        : form.start_location_type === "depot"
          ? copy.depot
          : shortenLocation(form.start_location, copy) || copy.customStart;
    const parts = compactRouteParts([start, shortenLocation(form.pickup_location, copy), shortenLocation(form.dropoff_location, copy)]);
    if (form.return_to_depot && normalizeRouteLocation(parts[parts.length - 1]) !== "depot") parts.push(copy.depot);
    return parts.join(" -> ");
  };

  const handleCalculateRouteDistance = useCallback(async () => {
    if (!form) return;
    const pickup = form.pickup_location.trim();
    const dropoff = form.dropoff_location.trim();

    if (!pickup || !dropoff) {
      setDistanceMessage(copy.routePickupDropoffRequired);
      return;
    }

    const routePlan = getTripRoutePlan(form);
    if (!routePlan) {
      setDistanceMessage(copy.routeStartRequired);
      return;
    }

    try {
      setCalculatingDistance(true);
      setDistanceMessage(null);
      setDistanceDurationText(null);
      const response = await fetch("/api/distance-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: routePlan.originPoint,
          destination: routePlan.destinationPoint,
          waypoints: routePlan.waypointPoints,
          bookingDate: form.trip_date,
          pickupTime: form.pickup_time
        })
      });
      const result = (await response.json()) as {
        success?: boolean;
        data?: DistanceEstimateResponse | null;
        error?: string | null;
      };

      if (!response.ok || !result.success || result.data?.distanceKm == null) {
        throw new Error(result.error || "Google Maps could not calculate this route.");
      }

      const estimate = result.data;
      const distanceMeters = Number(estimate.distanceMeters);
      const distanceKm = distanceMeters / 1000;
      const durationMinutes = estimate.durationSeconds ? Math.max(1, Math.round(estimate.durationSeconds / 60)) : null;
      const durationText = estimate.durationSeconds ? formatDuration(estimate.durationSeconds) : null;
      setHasUnsavedChanges(true);
      setForm((current) =>
        current
          ? {
              ...current,
              start_location_type: routePlan.startType,
              route_start_type: routePlan.startType,
              start_location: routePlan.startType === "pickup_only" ? "" : routePlan.origin,
              depot_address: routePlan.depotAddress,
              depot_address_used: routePlan.depotAddress,
              custom_start_address: routePlan.startType === "custom" ? routePlan.customStart : "",
              pickup_address: routePlan.pickup,
              dropoff_address: routePlan.dropoff,
              estimated_distance_km: distanceKm.toFixed(2),
              estimated_duration_minutes: durationMinutes?.toString() ?? "",
              google_estimated_km: distanceKm.toFixed(2),
              google_estimated_minutes: durationMinutes?.toString() ?? "",
              google_maps_route_url: routePlan.mapsUrl,
              route_source: estimate.provider,
              route_distance_meters: String(estimate.distanceMeters),
              route_duration_seconds: estimate.durationSeconds?.toString() ?? "",
              route_static_duration_seconds: estimate.staticDurationSeconds?.toString() ?? "",
              route_calculated_at: estimate.calculatedAt,
              route_departure_time: estimate.departureTime ?? "",
              route_preference: estimate.routePreference,
              route_label: estimate.routeLabel,
              route_description: estimate.routeDescription ?? "",
              route_polyline: estimate.encodedPolyline ?? "",
              route_traffic_aware: estimate.trafficAware,
              route_fallback_info: estimate.fallbackInfo
            }
          : current
      );
      const routeStatusMessage = estimate.fallbackRouteUsed
        ? copy.fallbackRouteUsed
        : estimate.trafficAware
          ? copy.trafficAwareEstimate
          : copy.trafficDataUnavailable;
      if (estimate.fallbackRouteUsed) {
        setDistanceMessage(
          `${copy.calculated}: ${distanceKm.toFixed(1)} km${durationMinutes != null ? ` / ${durationMinutes} min` : ""} · ${
            routeStatusMessage
          }`
        );
        setDistanceDurationText(durationText);
        return;
      }
      setDistanceMessage(
        `${copy.calculated}: ${distanceKm.toFixed(1)} km${durationMinutes != null ? ` / ${durationMinutes} min` : ""} · ${
          estimate.trafficAware ? copy.trafficAwareEstimate : copy.trafficDataUnavailable
        }`
      );
      setDistanceDurationText(durationText);
    } catch (err) {
      console.warn("Route distance calculation warning:", err);
      setDistanceMessage(`${copy.trafficDataUnavailable}. ${copy.routeCalculateFailed}`);
    } finally {
      setCalculatingDistance(false);
    }
  }, [copy, form]);

  const automaticTripRouteInputKey = useMemo(
    () => form
      ? JSON.stringify([
          form.start_location_type,
          form.start_location,
          form.depot_address,
          form.pickup_place_id,
          form.pickup_location,
          form.pickup_lat,
          form.pickup_lng,
          form.dropoff_place_id,
          form.dropoff_location,
          form.dropoff_lat,
          form.dropoff_lng,
          form.return_to_depot,
          form.trip_date,
          form.pickup_time
        ])
      : "",
    [form]
  );

  useEffect(() => {
    if (!form) return;
    if (automaticTripRouteInputRef.current === null) {
      automaticTripRouteInputRef.current = automaticTripRouteInputKey;
      return;
    }
    if (automaticTripRouteInputRef.current === automaticTripRouteInputKey) return;
    automaticTripRouteInputRef.current = automaticTripRouteInputKey;
    if (!getTripRoutePlan(form)) return;

    const timeoutId = window.setTimeout(() => {
      void handleCalculateRouteDistance();
    }, 900);
    return () => window.clearTimeout(timeoutId);
  }, [automaticTripRouteInputKey, form, handleCalculateRouteDistance]);

  const requestDeleteTrip = (trip: TripJourneyWithFuel) => {
    setDeleteTarget({
      id: trip.id,
      label: `${formatDate(trip.trip_date)} | ${getShortRoutePreview(trip, copy)}`
    });
  };

  const handleConfirmDeleteTrip = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      setError(null);
      await deleteTripJourney(deleteTarget.id);
      if (selectedTripId === deleteTarget.id) {
        setSelectedTripId(null);
        setForm(null);
        setHasUnsavedChanges(false);
      }
      setDeleteTarget(null);
      setNotice("Trip deleted successfully.");
      await load();
    } catch {
      setError("Unable to delete this trip. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveTrip = async () => {
    if (!form) return;
    const linkedFuelLogs = selectedTrip?.linkedFuelLogs ?? [];
    const start = toNumber(form.start_mileage);
    const end = toNumber(form.end_mileage);
    if (start != null && end != null && end < start) {
      setError("End mileage is lower than start mileage. Please check the readings.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const saved = await saveTripJourney({
        ...form,
        booking_diary_id: form.booking_diary_id || selectedTrip?.booking_diary_id || selectedTrip?.booking_id || null,
        booking_reference: form.booking_reference || selectedTrip?.booking_reference || null,
        start_location_type: form.start_location_type,
        route_start_type: form.start_location_type,
        start_location:
          form.start_location_type === "pickup_only"
            ? null
            : form.start_location_type === "depot"
              ? form.depot_address || DEPOT_ADDRESS
              : form.start_location,
        depot_address: form.depot_address || DEPOT_ADDRESS,
        depot_address_used: form.depot_address || DEPOT_ADDRESS,
        custom_start_address: form.start_location_type === "custom" ? form.start_location : null,
        pickup_address: form.pickup_location,
        dropoff_address: form.dropoff_location,
        pickup_display_name: form.pickup_display_name || form.pickup_location,
        dropoff_display_name: form.dropoff_display_name || form.dropoff_location,
        pickup_place_id: form.pickup_place_id || null,
        dropoff_place_id: form.dropoff_place_id || null,
        pickup_lat: toNumber(form.pickup_lat),
        pickup_lng: toNumber(form.pickup_lng),
        dropoff_lat: toNumber(form.dropoff_lat),
        dropoff_lng: toNumber(form.dropoff_lng),
        start_mileage: toNumber(form.start_mileage),
        end_mileage: toNumber(form.end_mileage),
        manual_actual_km: toNumber(form.manual_actual_km),
        estimated_distance_km: toNumber(form.estimated_distance_km),
        estimated_duration_minutes: toNumber(form.estimated_duration_minutes),
        google_estimated_km: toNumber(form.google_estimated_km),
        google_estimated_minutes: toNumber(form.google_estimated_minutes),
        route_source: form.route_source,
        route_distance_meters: toNumber(form.route_distance_meters),
        route_duration_seconds: toNumber(form.route_duration_seconds),
        route_static_duration_seconds: toNumber(form.route_static_duration_seconds),
        route_calculated_at: form.route_calculated_at || null,
        route_departure_time: form.route_departure_time || null,
        route_preference: form.route_preference || null,
        route_label: form.route_label || null,
        route_description: form.route_description || null,
        route_polyline: form.route_polyline || null,
        route_traffic_aware: form.route_traffic_aware,
        route_fallback_info: form.route_fallback_info,
        google_maps_route_url: form.google_maps_route_url,
        booking_estimated_km: toNumber(form.booking_estimated_km),
        booking_estimated_minutes: toNumber(form.booking_estimated_minutes),
        booking_google_maps_route_url: form.booking_google_maps_route_url,
        estimated_distance_source: form.route_source || selectedTrip?.estimated_distance_source || null,
        manual_estimated_distance_km: toNumber(form.manual_estimated_distance_km),
        manual_litres_used: toNumber(form.manual_litres_used),
        manual_fuel_cost: toNumber(form.manual_fuel_cost),
        include_in_financials: form.include_in_financials,
        original_trip_price: toNumber(form.original_trip_price),
        linkedFuelLogs
      });
      setSelectedTripId(saved.id);
      setHasUnsavedChanges(false);
      setNotice(copy.tripSavedSuccessfully);
      await load();
    } catch (err) {
      console.error("Trip save error:", err);
      setError(getFriendlyTripError(err, copy));
    } finally {
      setSaving(false);
    }
  };

  const handleLinkFuelLog = async (fuelLogId: string) => {
    if (!selectedTripId) return;
    try {
      setError(null);
      await linkFuelLogToTrip(selectedTripId, fuelLogId);
      setNotice(copy.fuelLogLinked);
      await load();
    } catch (err) {
      setError(getFriendlyTripError(err, copy));
    }
  };

  const handleUnlinkFuelLog = async (fuelLogId: string) => {
    if (!selectedTripId) return;
    try {
      setError(null);
      await unlinkFuelLogFromTrip(selectedTripId, fuelLogId);
      setNotice(copy.fuelLogUnlinked);
      await load();
    } catch (err) {
      setError(getFriendlyTripError(err, copy));
    }
  };

  const handleManualFuelConfirm = async () => {
    if (!form) return;
    const note = `[Fuel checked] ${copy.manualFuelConfirmationNote}`;
    setHasUnsavedChanges(true);
    setForm((current) => {
      if (!current) return current;
      const existingNotes = current.extra_route_notes.trim();
      return {
        ...current,
        fuel_source: "manual",
        extra_route_notes: existingNotes.toLowerCase().includes("fuel checked")
          ? current.extra_route_notes
          : [existingNotes, note].filter(Boolean).join("\n")
      };
    });
    setNotice(copy.fuelManuallyConfirmed);
  };

  return (
    <div className="space-y-5">
      <section className="surface-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-violet-700">
              EXPERT EXPRESS SENDER CO., LTD.
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
              {copy.tripJourney}
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              {copy.description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-violet-100 bg-violet-50/60 p-1">
              <button
                type="button"
                onClick={() => setPageMode("trips")}
                className={`rounded-lg px-4 py-2 text-sm font-black transition ${
                  pageMode === "trips"
                    ? "bg-white text-violet-800 shadow-sm"
                    : "text-slate-500 hover:text-violet-700"
                }`}
              >
                {language === "th" ? "ทริป" : "Trips"}
              </button>
              <button
                type="button"
                onClick={() => { setPageMode("results"); setAttentionFilter("all"); }}
                className={`rounded-lg px-4 py-2 text-sm font-black transition ${
                  pageMode === "results"
                    ? "bg-white text-violet-800 shadow-sm"
                    : "text-slate-500 hover:text-violet-700"
                }`}
              >
                {language === "th" ? "ผลลัพธ์" : "Results"}
              </button>
            </div>
            <button type="button" onClick={() => void load()} className="btn-secondary gap-2">
              <RefreshCw className="h-4 w-4" />
              {copy.refresh}
            </button>
          </div>
        </div>
        {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div> : null}
      </section>

      {pageMode === "trips" ? (
        <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => setAttentionFilter("all")}
          className="rounded-2xl border border-violet-100 bg-white p-4 text-left shadow-[0_10px_26px_rgba(76,29,149,0.05)] transition hover:border-violet-200 hover:bg-violet-50/30"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{copy.trips}</p>
              <p className="mt-1 text-3xl font-black text-slate-950">{summary.totalTrips}</p>
            </div>
            <div className="rounded-xl bg-violet-50 p-2.5 text-violet-700">
              <BarChart3 className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">
            {copy.completedTripsLabel}: {summary.completedTrips}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setAttentionFilter("missing_fuel")}
          className={`rounded-2xl border p-4 text-left shadow-[0_10px_26px_rgba(15,23,42,0.04)] transition ${
            operationalCounts.needsAttention > 0
              ? "border-amber-200 bg-amber-50/70 hover:bg-amber-50"
              : "border-emerald-100 bg-white hover:bg-emerald-50/30"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                {language === "th" ? "ต้องตรวจสอบ" : "Needs Attention"}
              </p>
              <p className="mt-1 text-3xl font-black text-slate-950">
                {operationalCounts.needsAttention}
              </p>
            </div>
            <div className={`rounded-xl p-2.5 ${operationalCounts.needsAttention > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
              <Gauge className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">
            {operationalCounts.needsAttention > 0
              ? (language === "th" ? "เชื้อเพลิงหรือข้อมูลยังต้องตรวจสอบ" : "Fuel or trip data still needs checking")
              : (language === "th" ? "ไม่มีรายการสำคัญที่ต้องแก้ไข" : "No major trip issues")}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setAttentionFilter("all")}
          className="rounded-2xl border border-sky-100 bg-white p-4 text-left shadow-[0_10px_26px_rgba(15,23,42,0.04)] transition hover:border-sky-200 hover:bg-sky-50/30"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                {language === "th" ? "พร้อมตรวจสอบ" : "Ready to Verify"}
              </p>
              <p className="mt-1 text-3xl font-black text-slate-950">
                {operationalCounts.readyToVerify}
              </p>
            </div>
            <div className="rounded-xl bg-sky-50 p-2.5 text-sky-700">
              <MapPinned className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">
            {language === "th" ? "งานเสร็จแล้วแต่ยังไม่ Data Ready" : "Completed trips not yet Data Ready"}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setFilters((current) => ({ ...current, dataStatus: "completed" }))}
          className="rounded-2xl border border-emerald-100 bg-white p-4 text-left shadow-[0_10px_26px_rgba(15,23,42,0.04)] transition hover:border-emerald-200 hover:bg-emerald-50/30"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                {language === "th" ? "ยืนยันแล้ว" : "Verified"}
              </p>
              <p className="mt-1 text-3xl font-black text-slate-950">{operationalCounts.verified}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700">
              <Link2 className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">
            {language === "th" ? "พร้อมใช้ในรายงาน" : "Data Ready for reporting"}
          </p>
        </button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-950">{copy.filters}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{copy.filtersDescription}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => applyQuickFilter("today")} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700">{copy.today}</button>
            <button type="button" onClick={() => applyQuickFilter("week")} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700">{copy.thisWeek}</button>
            <button type="button" onClick={() => setAttentionFilter("missing_fuel")} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100">
              {language === "th" ? "ต้องตรวจสอบ" : "Needs Attention"}
            </button>
            <button type="button" onClick={() => setFilters((current) => ({ ...current, dataStatus: "completed" }))} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100">
              {language === "th" ? "ยืนยันแล้ว" : "Verified"}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.15fr_1.15fr_1.4fr_1.15fr_auto]">
          <input type="date" value={filters.fromDate} onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value }))} className="form-input bg-white" />
          <input type="date" value={filters.toDate} onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value }))} className="form-input bg-white" />
          <select value={filters.driver} onChange={(event) => setFilters((current) => ({ ...current, driver: event.target.value }))} className="form-input bg-white">
            <option value="">{copy.allDrivers}</option>
            {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
          </select>
          <select value={filters.vehicle} onChange={(event) => setFilters((current) => ({ ...current, vehicle: event.target.value }))} className="form-input bg-white">
            <option value="">{copy.allVehicles}</option>
            {vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle}>{vehicle}</option>)}
          </select>
          <input value={filters.route} onChange={(event) => setFilters((current) => ({ ...current, route: event.target.value }))} placeholder={copy.route} className="form-input bg-white" />
          <select value={filters.dataStatus} onChange={(event) => setFilters((current) => ({ ...current, dataStatus: event.target.value as TripFilter["dataStatus"] }))} className="form-input bg-white">
            <option value="all">{language === "th" ? "สถานะทั้งหมด" : "All statuses"}</option>
            <option value="missing">{language === "th" ? "ต้องตรวจสอบ" : "Needs Attention"}</option>
            <option value="completed">{language === "th" ? "ยืนยันแล้ว" : "Verified"}</option>
          </select>
          <button type="button" onClick={() => { setFilters(emptyFilters); setAttentionFilter("all"); }} className="btn-secondary min-h-11 whitespace-nowrap px-4 py-2 text-sm">
            {copy.resetFilters}
          </button>
        </div>
      </section>

      <section className={`rounded-2xl border p-4 shadow-sm ${
        operationalCounts.needsAttention > 0
          ? "border-amber-200 bg-amber-50/45"
          : "border-emerald-100 bg-emerald-50/35"
      }`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="section-title">{copy.needsAttention}</h3>
            <p className="section-subtitle">
              {operationalCounts.needsAttention > 0
                ? (language === "th" ? "เลือกปัญหาเพื่อกรองรายการทริปที่ต้องแก้ไข" : "Choose an issue to focus the trips that still need checking.")
                : (language === "th" ? "ทุกทริปที่แสดงอยู่ตรวจสอบเรียบร้อย" : "All visible trips are up to date.")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {operationalCounts.needsAttention > 0 ? (
              <button type="button" onClick={() => setAttentionFilter("missing_fuel")} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold text-amber-800 shadow-sm">
                <span className="block text-[10px] uppercase tracking-[0.08em] text-amber-600">{copy.missingFuel}</span>
                <span className="mt-0.5 block text-sm text-slate-950">{operationalCounts.missingFuel} {operationalCounts.missingFuel === 1 ? copy.trip : copy.trips}</span>
              </button>
            ) : null}
            {operationalCounts.missingMileage > 0 ? (
              <button type="button" onClick={() => setAttentionFilter("missing_mileage")} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold text-amber-800 shadow-sm">
                <span className="block text-[10px] uppercase tracking-[0.08em] text-amber-600">{copy.missingMileage}</span>
                <span className="mt-0.5 block text-sm text-slate-950">{operationalCounts.missingMileage} {operationalCounts.missingMileage === 1 ? copy.trip : copy.trips}</span>
              </button>
            ) : null}
            {operationalCounts.missingEstimate > 0 ? (
              <button type="button" onClick={() => setAttentionFilter("missing_estimate")} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold text-amber-800 shadow-sm">
                <span className="block text-[10px] uppercase tracking-[0.08em] text-amber-600">{copy.missingEstimate}</span>
                <span className="mt-0.5 block text-sm text-slate-950">{operationalCounts.missingEstimate} {operationalCounts.missingEstimate === 1 ? copy.trip : copy.trips}</span>
              </button>
            ) : null}

            {attentionFilter !== "all" ? (
              <button type="button" onClick={() => setAttentionFilter("all")} className="btn-secondary min-h-10 px-3 py-2 text-xs">
                {copy.showAllTrips}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <details className="hidden rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm shadow-slate-950/5">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="section-title">{copy.reportsSecondary}</h3>
              <p className="section-subtitle">{copy.reportsSecondaryDescription}</p>
            </div>
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">{copy.view}</span>
          </div>
        </summary>
        <div className="mt-4 space-y-4">
      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><MapPinned className="h-5 w-5" /></div>
            <div>
              <h3 className="section-title">{copy.routeAccuracy}</h3>
              <p className="section-subtitle">{copy.comparePlannedActual}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.averageDifference}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.averageDifference)} km</p></div>
            <div className={metricTileClass(summary.largestRouteDifference != null ? "amber" : "slate")}><p className="text-xs font-semibold opacity-80">{copy.largestDifference}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.largestRouteDifference)} km</p></div>
            <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.mostAccurateRoute}</p><p className="truncate font-bold text-slate-950">{summary.mostAccurateRoute?.route ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.mostAccurateRoute?.averageDifferenceKm)} km</p></div>
            <div className={metricTileClass("amber")}><p className="text-xs font-semibold opacity-80">{copy.leastAccurateRoute}</p><p className="truncate font-bold text-slate-950">{summary.leastAccurateRoute?.route ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.leastAccurateRoute?.averageDifferenceKm)} km</p></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-brand-50 p-2 text-brand-700"><BarChart3 className="h-5 w-5" /></div>
            <div>
              <h3 className="section-title">{copy.monthlyTrends}</h3>
              <p className="section-subtitle">{summary.monthlyTrends.map((month) => month.label).join(" / ") || "-"}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              { label: copy.tripsCompletedTrend, values: summary.monthlyTrends.map((month) => month.completed), value: summary.completedTrips },
              { label: copy.distanceTravelledTrend, values: summary.monthlyTrends.map((month) => month.distance), value: summary.totalActual },
              { label: copy.fuelUsedTrend, values: summary.monthlyTrends.map((month) => month.litres), value: summary.totalLitres },
              { label: copy.fuelCostTrend, values: summary.monthlyTrends.map((month) => month.cost), value: summary.totalCost, money: true }
            ].map((trend) => (
              <div key={trend.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-bold uppercase text-slate-500">{trend.label}</p>
                  <p className="font-bold text-slate-950">{trend.money ? formatCurrency(trend.value) : formatNumber(trend.value, trend.label === copy.fuelUsedTrend ? 2 : 0)}</p>
                </div>
                <svg viewBox="0 0 220 62" className="mt-2 h-16 w-full overflow-visible" role="img" aria-label={trend.label}>
                  <polyline points={getTrendPolyline(trend.values)} fill="none" stroke="currentColor" strokeWidth="3" className="text-brand-600" vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{copy.driverLeaderboard}</h3>
            <p className="section-subtitle">{copy.topDriversHelper}</p>
          </div>
          <button type="button" onClick={() => { setComparisonTab("drivers"); setComparisonSort("best_kml"); }} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
            {copy.sortBestKmL}
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3 text-left">{copy.rank}</th>
                <th className="px-3 py-3 text-left">{copy.driver}</th>
                <th className="px-3 py-3 text-left">{copy.vehicle}</th>
                <th className="px-3 py-3 text-right">{copy.completed}</th>
                <th className="px-3 py-3 text-right">{copy.distanceTravelled}</th>
                <th className="px-3 py-3 text-right">{copy.estimatedKm}</th>
                <th className="px-3 py-3 text-right">{copy.avgDifference}</th>
                <th className="px-3 py-3 text-left">{copy.label}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {topDriverRows.map((row, index) => (
                <tr key={row.name} className="transition hover:bg-brand-50/45">
                  <td className="px-3 py-3 font-bold text-slate-950">#{index + 1}</td>
                  <td className="px-3 py-3 font-bold text-slate-950">{row.name}</td>
                  <td className="px-3 py-3">{row.vehicle}</td>
                  <td className="px-3 py-3 text-right font-semibold">{row.completedTrips}</td>
                  <td className="px-3 py-3 text-right">{formatNumber(row.actualKm)} km</td>
                  <td className="px-3 py-3 text-right">{formatNumber(row.estimatedKm)} km</td>
                  <td className="px-3 py-3 text-right">{formatNumber(row.averageDifferenceKm)} km</td>
                  <td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel, copy)}`}>{row.performanceLabel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
        </div>
      </details>

      <section id="trip-records" className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="section-title">{language === "th" ? "ทริป" : "Trips"}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{filteredTrips.length} {filteredTrips.length === 1 ? copy.trip : copy.trips}</span>
            </div>
            <p className="section-subtitle">{copy.tripRecordsDescription}</p>
          </div>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">{copy.loadingTripJourneys}</p>
        ) : filteredTrips.length === 0 ? (
          <div className="mt-4"><EmptyState title={copy.noTripRecordsYet} description={copy.noTripRecordsDescription} /></div>
        ) : (
          <div className="mt-4 space-y-3">
            {visibleTrips.map((trip) => {
              const metrics = getTripMetrics(trip);
              const derivedStatus = getDerivedTripStatus(trip);
              const jobStatus = getTripJobStatus(trip);
              const fuelCycle = getFuelCycleForTrip(trip, fuelCycles);
              const possibleFuelLogs = getPossibleFuelLogsForTrip(trip, fuelLogs, fuelCycle);
              const fuelCycleCoverage = getFuelCycleCoverage(fuelCycle, baseFilteredTrips);
              const incompleteFuelLog = getIncompleteLinkedFuelLog(trip, fuelLogs, fuelCycle);
              const fuelCycleState = getFuelCycleVerificationState(fuelCycle, copy, incompleteFuelLog);
              const fuelStatus = getFuelReviewStatus(trip, possibleFuelLogs, fuelCycle);
              const dataReadiness = getTripDataReadiness(trip, weeklyMileage, copy, baseFilteredTrips, possibleFuelLogs, fuelCycle);
              const mileageVerificationLabel = getMileageVerificationLabel(dataReadiness, dataReadiness.weeklyCheck.label, copy);
              const fuelEventOk = hasFuelEvent(trip);
              const bookingLinked = Boolean(trip.booking_id || trip.booking_diary_id || trip.booking_reference);
              const distanceReview = getDistanceReview(metrics);
              const attentionAction = dataReadiness.status === "needs_fuel_check" ? (fuelStatus === "possible" ? copy.reviewLinkFuelLog : copy.linkFuelLogAction) : statusActionText(derivedStatus, copy);
              const topPossibleFuelLog = possibleFuelLogs[0] ?? null;
              return (
                <article id={`trip-${trip.id}`} key={trip.id} className={`scroll-mt-6 rounded-2xl border px-4 py-4 shadow-sm transition hover:border-violet-200 hover:shadow-md ${getStatusAccent(dataReadiness.status === "data_ready" ? "completed" : "missing_fuel")} ${selectedTripId === trip.id ? "border-brand-300 ring-2 ring-brand-200" : "border-slate-200 hover:border-brand-200"}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedTripId === trip.id ? <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-bold text-white">{copy.selectedTrip}</span> : null}
                        <p className="text-sm font-bold text-slate-950">{formatDate(trip.trip_date)}</p>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tripJobStatusClass(jobStatus)}`}>{copy.tripStatus}: {tripJobStatusLabel(jobStatus, copy)}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${dataStatusClass(dataReadiness.status)}`}>{copy.dataStatus}: {dataReadiness.label}</span>
                        {trip.include_in_financials === false ? <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{copy.financiallyExcluded}</span> : null}
                      </div>
                      <p className="mt-2 truncate text-lg font-bold leading-6 text-slate-950" title={getRoutePreview(trip)}>{getShortRoutePreview(trip, copy)}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-600">
                        <span>{copy.driver}: {trip.driver || "-"}</span>
                        <span>{copy.vehicle}: {trip.vehicle_reg || trip.vehicle_type || "-"}</span>
                        <span>{copy.estimatedKm}: {metrics.estimatedDistance == null ? "-" : `${formatNumber(metrics.estimatedDistance)} km`}</span>
                        <span>{copy.workingDistance}: {metrics.workingDistance == null ? "-" : `${formatNumber(metrics.workingDistance)} km`}</span>
                        <span>{copy.difference}: {metrics.differenceKm == null ? "-" : `${formatNumber(metrics.differenceKm)} km`}</span>
                        <span>{copy.distanceSource}: {metrics.distanceSource}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${bookingLinked ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{bookingLinked ? copy.bookingLinked : copy.bookingNotLinked}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${distanceReview.matched ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{distanceReview.matched ? copy.distanceMatched : copy.distanceNeedsReview}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${fuelStatusClass(fuelStatus)}`}>{fuelCycle || incompleteFuelLog ? fuelCycleState.title : getFuelStatusLabel(fuelStatus, copy)}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${dataReadiness.issues.weeklyMileage ? "border-yellow-200 bg-yellow-50 text-yellow-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{mileageVerificationLabel}</span>
                      </div>
                      {topPossibleFuelLog ? (
                        <div className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-semibold text-yellow-900">
                          <p>{copy.possibleFuelLogFound}: {formatDate(topPossibleFuelLog.date)} | {topPossibleFuelLog.vehicle_reg || "-"} | {topPossibleFuelLog.driver || "-"} | {formatNumber(Number(topPossibleFuelLog.litres || 0), 2)} L | {formatCurrency(Number(topPossibleFuelLog.total_cost || 0))}</p>
                          <p className="mt-1 text-yellow-800">{topPossibleFuelLog.mileage ? `${copy.mileage}: ${formatNumber(Number(topPossibleFuelLog.mileage))} km` : ""}{topPossibleFuelLog.station || topPossibleFuelLog.location ? ` | ${topPossibleFuelLog.station || topPossibleFuelLog.location}` : ""}</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => openTrip(trip)}
                        className="btn-primary min-h-9 px-4 py-2 text-xs"
                      >
                        {dataReadiness.status === "data_ready"
                          ? (language === "th" ? "ดูทริป" : "View Trip")
                          : (language === "th" ? "ตรวจสอบทริป" : "Review Trip")}
                      </button>

                      {fuelStatus === "possible" || dataReadiness.status === "needs_fuel_check" ? (
                        <button
                          type="button"
                          onClick={() => {
                            openTrip(trip);
                            setReviewStep(2);
                            setSelectedTripTab("fuel");
                            setManualFuelExpanded(true);
                          }}
                          className="btn-secondary min-h-9 px-3 py-2 text-xs"
                        >
                          {fuelStatus === "possible" ? copy.reviewLinkFuelLog : copy.linkFuelLogAction}
                        </button>
                      ) : null}

                      {trip.booking_id || trip.booking_diary_id ? (
                        <a
                          href={`/booking-diary?bookingId=${encodeURIComponent(String(trip.booking_id ?? trip.booking_diary_id))}`}
                          className="btn-secondary min-h-9 px-3 py-2 text-xs"
                        >
                          {copy.openBooking}
                        </a>
                      ) : null}

                      <details className="relative">
                        <summary className="flex min-h-9 cursor-pointer list-none items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50">
                          •••
                        </summary>
                        <div className="absolute right-0 top-10 z-20 min-w-[150px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                          <button
                            type="button"
                            onClick={() => requestDeleteTrip(trip)}
                            className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-50"
                          >
                            {copy.delete}
                          </button>
                        </div>
                      </details>
                    </div>
                  </div>
                </article>
              );
            })}
            {visibleTrips.length < filteredTrips.length ? (
              <button type="button" onClick={() => setVisibleTripCount((count) => count + 10)} className="btn-secondary w-full min-h-10 px-4 py-2 text-sm">
                {copy.loadMoreTrips}
              </button>
            ) : null}
          </div>
        )}
      </section>

        </>
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl border border-violet-100 bg-[linear-gradient(135deg,#faf8ff_0%,#ffffff_55%,#f8fafc_100%)] p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">
                  {language === "th" ? "ผลลัพธ์จากทริปที่ตรวจสอบแล้ว" : "Verified Trip Results"}
                </p>
                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {language === "th" ? "สิ่งที่ข้อมูล Trip Journey กำลังบอกเรา" : "What the Trip Journey data is telling us"}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                  {language === "th"
                    ? "ผลลัพธ์หลักใช้เฉพาะทริปที่ Data Ready เพื่อไม่ให้ข้อมูลที่ยังไม่ตรวจสอบบิดเบือนผลลัพธ์"
                    : "Core results use Data Ready trips only, so incomplete fuel or mileage checks do not distort the analysis."}
                </p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-800">
                {resultsData.verifiedTrips.length} {language === "th" ? "ทริปที่ตรวจแล้ว" : "verified trips"}
              </span>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-950">
                  {language === "th" ? "ตัวกรองผลลัพธ์" : "Results filters"}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {language === "th" ? "ใช้ช่วงวันที่ คนขับ รถ หรือเส้นทางเพื่อดูผลเฉพาะส่วน" : "Filter the analysis by date, driver, vehicle or route."}
                </p>
              </div>
              <button type="button" onClick={() => setFilters(emptyFilters)} className="btn-secondary min-h-10 px-3 py-2 text-xs">
                {copy.resetFilters}
              </button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <input type="date" value={filters.fromDate} onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value }))} className="form-input bg-white" />
              <input type="date" value={filters.toDate} onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value }))} className="form-input bg-white" />
              <select value={filters.driver} onChange={(event) => setFilters((current) => ({ ...current, driver: event.target.value }))} className="form-input bg-white">
                <option value="">{copy.allDrivers}</option>
                {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
              </select>
              <select value={filters.vehicle} onChange={(event) => setFilters((current) => ({ ...current, vehicle: event.target.value }))} className="form-input bg-white">
                <option value="">{copy.allVehicles}</option>
                {vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle}>{vehicle}</option>)}
              </select>
              <input value={filters.route} onChange={(event) => setFilters((current) => ({ ...current, route: event.target.value }))} placeholder={copy.route} className="form-input bg-white" />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                label: language === "th" ? "ทริปที่ตรวจแล้ว" : "Verified Trips",
                value: formatNumber(resultsData.verifiedTrips.length),
                helper: language === "th" ? "ใช้ในผลลัพธ์" : "Used in results"
              },
              {
                label: language === "th" ? "กม. ตามแผน" : "Planned KM",
                value: `${formatNumber(resultsData.totalPlannedKm, 1)} km`,
                helper: language === "th" ? "รวมระยะทางประมาณการ" : "Total estimated distance"
              },
              {
                label: language === "th" ? "กม. ใช้งาน" : "Working KM",
                value: `${formatNumber(resultsData.totalWorkingKm, 1)} km`,
                helper: language === "th" ? "ระยะทางที่ใช้ตรวจสอบ" : "Verified working distance"
              },
              {
                label: language === "th" ? "ส่วนต่างรวม" : "Total Variance",
                value: `${resultsData.totalDifferenceKm >= 0 ? "+" : ""}${formatNumber(resultsData.totalDifferenceKm, 1)} km`,
                helper: language === "th" ? "Working - Planned" : "Working - Planned"
              },
              {
                label: language === "th" ? "ส่วนต่างเฉลี่ย" : "Avg Variance",
                value: resultsData.averageVariancePercent == null ? "-" : `${formatNumber(resultsData.averageVariancePercent, 1)}%`,
                helper: language === "th" ? "ค่าเฉลี่ยแบบสัมบูรณ์" : "Average absolute variance"
              }
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-violet-100 bg-white p-4 shadow-[0_10px_26px_rgba(76,29,149,0.04)]">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{card.label}</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{card.value}</p>
                <p className="mt-1 text-xs text-slate-500">{card.helper}</p>
              </div>
            ))}
          </section>

          {resultsData.verifiedTrips.length < 5 ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
              <p className="font-black text-amber-900">
                {language === "th" ? "ข้อมูลยังมีน้อยสำหรับการเปรียบเทียบ" : "More verified trips are needed for stronger comparisons"}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                {language === "th"
                  ? "ตอนนี้แสดงผลจริงที่มีอยู่ แต่ยังไม่ควรใช้เพื่อจัดอันดับคนขับหรือรถ เมื่อมีอย่างน้อย 5 ทริปผลจะเริ่มมีความหมายมากขึ้น"
                  : "The figures below are real, but we will not treat them as driver or vehicle rankings yet. Comparisons become more useful once at least 5 verified trips are available."}
              </p>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="section-title">{language === "th" ? "ผลลัพธ์ตามเส้นทาง" : "Route Results"}</h3>
                <p className="section-subtitle">
                  {language === "th" ? "เปรียบเทียบระยะทางตามแผนกับระยะทางใช้งานของเส้นทางรับสินค้า → ส่งสินค้า จาก Booking Diary" : "Compare planned and working distance for Booking Diary pickup → drop-off routes."}
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {resultsData.repeatRoutes.length} {language === "th" ? "เส้นทางซ้ำ" : "repeat routes"}
              </span>
            </div>

            {resultsData.routes.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                {language === "th" ? "ยังไม่มีทริป Data Ready สำหรับวิเคราะห์เส้นทาง" : "No Data Ready trips are available for route analysis yet."}
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {resultsData.routes.slice(0, 8).map((route) => (
                  <div key={route.route} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 lg:grid-cols-[2fr_0.65fr_0.8fr_0.8fr_0.8fr] lg:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-black text-slate-950" title={route.route}>{route.route}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {route.trips >= 3
                          ? `${language === "th" ? "แนวโน้มเส้นทาง:" : "Route trend:"} ${(route.averageDifferenceKm ?? 0) >= 0 ? "+" : ""}${formatNumber(route.averageDifferenceKm, 1)} km ${language === "th" ? "เทียบกับ Booking" : "vs booking"}`
                          : route.trips >= 2
                            ? (language === "th" ? "มีข้อมูลเส้นทางซ้ำ — เพิ่มอีก 1 ทริปเพื่อเริ่มเห็นแนวโน้ม" : "Repeat-route data available — 1 more trip will start showing a route trend")
                            : (language === "th" ? "มีเพียง 1 ทริป" : "Only 1 verified trip")}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400">{language === "th" ? "ทริป" : "Trips"}</p>
                      <p className="font-black text-slate-950">{route.trips}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400">{language === "th" ? "แผนเฉลี่ย" : "Avg planned"}</p>
                      <p className="font-black text-slate-950">{formatNumber(route.averagePlannedKm, 1)} km</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400">{language === "th" ? "ใช้งานเฉลี่ย" : "Avg working"}</p>
                      <p className="font-black text-slate-950">{formatNumber(route.averageWorkingKm, 1)} km</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400">{copy.difference}</p>
                      <p className={`font-black ${(route.averageDifferenceKm ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                        {(route.averageDifferenceKm ?? 0) >= 0 ? "+" : ""}{formatNumber(route.averageDifferenceKm, 1)} km
                        {route.averageDifferencePercent != null ? ` (${route.averageDifferencePercent >= 0 ? "+" : ""}${formatNumber(route.averageDifferencePercent, 1)}%)` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="section-title">{language === "th" ? "ภาพรวมคนขับ" : "Driver Comparison"}</h3>
              <p className="section-subtitle">
                {language === "th" ? "แสดงจำนวนทริปและส่วนต่างระยะทาง ไม่จัดอันดับเมื่อข้อมูลยังน้อย" : "Shows trip volume and distance variance without ranking people when the sample is small."}
              </p>
              <div className="mt-4 space-y-2">
                {resultsData.drivers.slice(0, 6).map((row) => (
                  <div key={row.name} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-black text-slate-950">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.trips} {row.trips === 1 ? copy.trip : copy.trips}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-slate-950">{formatNumber(row.workingKm, 1)} km</p>
                      <p className="text-xs text-slate-500">
                        {language === "th" ? "ส่วนต่างเฉลี่ย" : "Avg variance"}: {formatNumber(row.averageDifferenceKm, 1)} km
                      </p>
                    </div>
                  </div>
                ))}
                {resultsData.drivers.length === 0 ? <p className="text-sm text-slate-500">{copy.enoughDataNeeded}</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="section-title">{language === "th" ? "ภาพรวมรถ" : "Vehicle Comparison"}</h3>
              <p className="section-subtitle">
                {language === "th" ? "แสดงระยะทางและส่วนต่างของรถจากทริปที่ตรวจแล้ว" : "Shows verified distance and variance by vehicle."}
              </p>
              <div className="mt-4 space-y-2">
                {resultsData.vehicles.slice(0, 6).map((row) => (
                  <div key={row.name} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-black text-slate-950">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.trips} {row.trips === 1 ? copy.trip : copy.trips}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-slate-950">{formatNumber(row.workingKm, 1)} km</p>
                      <p className="text-xs text-slate-500">
                        {language === "th" ? "ส่วนต่างเฉลี่ย" : "Avg variance"}: {formatNumber(row.averageDifferenceKm, 1)} km
                      </p>
                    </div>
                  </div>
                ))}
                {resultsData.vehicles.length === 0 ? <p className="text-sm text-slate-500">{copy.enoughDataNeeded}</p> : null}
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">
                  {language === "th" ? "ความครอบคลุมของทริปที่เชื่อมโยง" : "Linked Trip Coverage"}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {resultsData.averageFuelCycleCoverage == null ? "-" : `${formatNumber(resultsData.averageFuelCycleCoverage, 1)}%`}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  {resultsData.totalRelevantFuelCycleKm > 0
                    ? `${formatNumber(resultsData.totalLinkedTripKm, 1)} km ${language === "th" ? "เชื่อมโยงจาก" : "linked /"} ${formatNumber(resultsData.totalRelevantFuelCycleKm, 1)} km ${language === "th" ? "ในรอบน้ำมันที่เกี่ยวข้อง" : "relevant fuel-cycle movement"}`
                    : (language === "th" ? "ยังไม่มีรอบน้ำมันที่เกี่ยวข้อง" : "No relevant fuel-cycle movement yet")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {language === "th"
                    ? "แสดงว่าการเคลื่อนที่ในรอบน้ำมันที่เกี่ยวข้องอธิบายได้ด้วยทริปที่ตรวจแล้วมากน้อยเพียงใด"
                    : "Shows how much relevant fuel-cycle movement is explained by verified linked trips."}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">
                  {language === "th" ? "การเคลื่อนที่ที่ยังไม่จัดสรร" : "Unallocated movement"}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">{formatNumber(resultsData.totalUnallocatedKm, 1)} km</p>
                <p className="mt-1 text-xs text-slate-500">
                  {language === "th"
                    ? "ระยะทางในรอบน้ำมันที่เกี่ยวข้องซึ่งยังไม่ถูกอธิบายด้วยทริปที่ตรวจแล้ว อาจเป็นการกลับคลัง ย้ายรถ หรืองานที่ยังไม่ได้เชื่อม"
                    : "Relevant fuel-cycle distance not yet explained by verified trips; it may be depot movement, repositioning or jobs not yet linked."}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">
                  {language === "th" ? "คุณภาพข้อมูล" : "Data quality"}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {baseFilteredTrips.length > 0 ? `${formatNumber((resultsData.verifiedTrips.length / baseFilteredTrips.length) * 100, 0)}%` : "-"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {operationalCounts.needsAttention > 0
                    ? `${operationalCounts.needsAttention} ${language === "th" ? "ทริปยังต้องตรวจสอบ" : "trip(s) still need attention"}`
                    : (language === "th" ? "ทริปทั้งหมดในตัวกรองพร้อมใช้งาน" : "All filtered trips are Data Ready.")}
                </p>
              </div>
            </div>
          </section>

          {operationalCounts.needsAttention > 0 ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-black text-amber-900">
                    {language === "th" ? "ยังมีข้อมูลที่ต้องแก้ไข" : "Some trip data still needs attention"}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    {operationalCounts.missingFuel} {language === "th" ? "ต้องตรวจน้ำมัน" : "fuel checks"} · {operationalCounts.missingMileage} {language === "th" ? "ต้องตรวจระยะทาง" : "mileage checks"} · {operationalCounts.missingEstimate} {language === "th" ? "ไม่มี estimate" : "missing estimates"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPageMode("trips");
                    setFilters((current) => ({ ...current, dataStatus: "missing" }));
                    setAttentionFilter("all");
                  }}
                  className="btn-secondary min-h-10 px-4 py-2 text-sm"
                >
                  {language === "th" ? "ไปแก้ไขทริป" : "Review problem trips"}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      )}

      {form && selectedTrip ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/35 px-3 py-4 backdrop-blur-[2px] sm:px-5">
          <section className="my-auto w-full max-w-[1500px] overflow-hidden rounded-[1.5rem] border border-violet-100 bg-[#fbfbff] shadow-[0_30px_90px_rgba(30,20,70,0.25)]">
            {(() => {
              const selectedFuelCycle = selectedTripFuelCycle;
              const selectedPossibleFuelLogs = getPossibleFuelLogsForTrip(selectedTrip, fuelLogs, selectedFuelCycle);
              const selectedFuelCycleCoverage = getFuelCycleCoverage(selectedFuelCycle, baseFilteredTrips);
              const selectedIncompleteFuelLog = getIncompleteLinkedFuelLog(selectedTrip, fuelLogs, selectedFuelCycle);
              const selectedFuelCycleState = getFuelCycleVerificationState(selectedFuelCycle, copy, selectedIncompleteFuelLog);
              const selectedFuelStatus = getFuelReviewStatus(selectedTrip, selectedPossibleFuelLogs, selectedFuelCycle);
              const selectedWeeklyCheck = getWeeklyMileageCheck(selectedTrip, baseFilteredTrips, weeklyMileage, copy);
              const selectedDataReadiness = getTripDataReadiness(
                selectedTrip,
                weeklyMileage,
                copy,
                baseFilteredTrips,
                selectedPossibleFuelLogs,
                selectedFuelCycle
              );
              const selectedJobStatus = getTripJobStatus(selectedTrip);
              const mileageVerified = !selectedDataReadiness.issues.weeklyMileage;
              const distanceReady =
                selectedFormMetrics?.workingDistance != null &&
                Number(selectedFormMetrics.workingDistance) > 0;
              const fuelChecked =
                selectedFuelStatus === "linked" ||
                selectedFuelStatus === "manual" ||
                selectedFuelStatus === "cycle";
              const bookingLinked = Boolean(selectedTrip.booking_id || selectedTrip.booking_diary_id);

              return (
                <>
                  <div className="sticky top-0 z-20 border-b border-violet-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white">
                            {language === "th" ? "ตรวจสอบทริป" : "Review Trip"}
                          </span>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${tripJobStatusClass(selectedJobStatus)}`}>
                            {tripJobStatusLabel(selectedJobStatus, copy)}
                          </span>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${dataStatusClass(selectedDataReadiness.status)}`}>
                            {selectedDataReadiness.label}
                          </span>
                        </div>
                        <h2 className="mt-2 truncate text-xl font-black text-slate-950 sm:text-2xl" title={getRoutePreview(selectedTrip)}>
                          {getShortRoutePreview(selectedTrip, copy)}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                          {formatDate(selectedTrip.trip_date)} · {copy.driver}: {selectedTrip.driver || "-"} · {copy.vehicle}: {selectedTrip.vehicle_reg || "-"}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={closeTripReview}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-500 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                        aria-label={language === "th" ? "ปิด" : "Close review"}
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {[
                        { step: 1 as ReviewStep, label: language === "th" ? "ทริป" : "Trip" },
                        { step: 2 as ReviewStep, label: language === "th" ? "เชื้อเพลิงและระยะทาง" : "Fuel & Mileage" },
                        { step: 3 as ReviewStep, label: language === "th" ? "ตรวจสอบและบันทึก" : "Verify" }
                      ].map((item) => {
                        const complete = reviewStep > item.step;
                        const active = reviewStep === item.step;
                        return (
                          <button
                            key={item.step}
                            type="button"
                            onClick={() => setReviewStep(item.step)}
                            className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 text-left text-xs font-black uppercase tracking-[0.07em] transition sm:text-sm ${
                              complete
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : active
                                  ? "border-violet-300 bg-violet-50 text-violet-800"
                                  : "border-slate-200 bg-slate-50 text-slate-400 hover:border-violet-200 hover:text-violet-700"
                            }`}
                          >
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                              complete
                                ? "bg-emerald-500 text-white"
                                : active
                                  ? "bg-violet-600 text-white"
                                  : "bg-white text-slate-400"
                            }`}>
                              {complete ? "✓" : item.step}
                            </span>
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="max-h-[calc(100vh-190px)] overflow-y-auto px-4 py-5 sm:px-6">
                    {error ? (
                      <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                        {error}
                      </div>
                    ) : null}
                    {notice ? (
                      <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                        {notice}
                      </div>
                    ) : null}

                    {reviewStep === 1 ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 lg:grid-cols-4">
                          <div className="rounded-2xl border border-violet-100 bg-white p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{copy.date}</p>
                            <p className="mt-1 font-black text-slate-950">{formatDate(selectedTrip.trip_date)}</p>
                          </div>
                          <div className="rounded-2xl border border-violet-100 bg-white p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{copy.driver}</p>
                            <p className="mt-1 font-black text-slate-950">{selectedTrip.driver || "-"}</p>
                          </div>
                          <div className="rounded-2xl border border-violet-100 bg-white p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{copy.vehicle}</p>
                            <p className="mt-1 font-black text-slate-950">{selectedTrip.vehicle_reg || "-"}</p>
                          </div>
                          <div className="rounded-2xl border border-violet-100 bg-white p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{copy.bookingRef}</p>
                            <p className="mt-1 truncate font-black text-slate-950">
                              {selectedTrip.booking_reference || (language === "th" ? "ไม่มีเลขอ้างอิงการจอง" : "No booking reference")}
                            </p>
                          </div>
                        </div>

                        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">
                                {language === "th" ? "เส้นทางจาก Booking Diary" : "Booking Diary route"}
                              </p>
                              <h3 className="mt-1 text-lg font-black text-slate-950">{getShortRoutePreview(selectedTrip, copy)}</h3>
                              <p className="mt-1 text-xs text-slate-500">
                                {language === "th"
                                  ? "ข้อมูลหลักมาจาก Booking Diary และแก้ไขเฉพาะเมื่อจำเป็น"
                                  : "Main trip information comes from Booking Diary. Only adjust it here when necessary."}
                              </p>
                            </div>
                            <span className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700">
                              {language === "th" ? "ข้อมูลจาก Booking Diary" : "Booking Diary source"}
                            </span>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <div className="rounded-xl bg-violet-50/70 p-4">
                              <p className="text-xs font-semibold text-slate-500">{language === "th" ? "ระยะทางแผน" : "Planned distance"}</p>
                              <p className="mt-1 text-2xl font-black text-slate-950">{formatNumber(selectedFormMetrics?.estimatedDistance)} km</p>
                              <p className="text-xs text-slate-500">{selectedEstimateSource}</p>
                            </div>
                            <div className="rounded-xl bg-emerald-50/70 p-4">
                              <p className="text-xs font-semibold text-slate-500">{language === "th" ? "ระยะทางใช้งาน" : "Working distance"}</p>
                              <p className="mt-1 text-2xl font-black text-slate-950">{formatNumber(selectedFormMetrics?.workingDistance)} km</p>
                              <p className="text-xs text-slate-500">{selectedFormMetrics?.actualSource}</p>
                            </div>
                            <div className="rounded-xl bg-amber-50/70 p-4">
                              <p className="text-xs font-semibold text-slate-500">{copy.difference}</p>
                              <p className="mt-1 text-2xl font-black text-slate-950">{formatNumber(selectedFormMetrics?.differenceKm)} km</p>
                              <p className="text-xs text-slate-500">{distanceReady ? (language === "th" ? "พร้อมตรวจสอบ" : "Ready to check") : copy.notCalculated}</p>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                                {language === "th" ? "จุดรับสินค้า" : "Pickup"}
                              </p>
                              <p className="mt-1 text-base font-black text-slate-950">
                                {selectedTrip.pickup_location || (language === "th" ? "ไม่มีข้อมูล" : "Not available")}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {language === "th" ? "ดึงจาก Booking Diary" : "From Booking Diary"}
                              </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                                {language === "th" ? "จุดส่งสินค้า" : "Drop-off"}
                              </p>
                              <p className="mt-1 text-base font-black text-slate-950">
                                {selectedTrip.dropoff_location || (language === "th" ? "ไม่มีข้อมูล" : "Not available")}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {language === "th" ? "ดึงจาก Booking Diary" : "From Booking Diary"}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
                            <p className="text-sm font-black text-violet-900">
                              {language === "th" ? "Trip Journey ใช้ข้อมูลงานจาก Booking Diary" : "Trip Journey uses the Booking Diary job"}
                            </p>
                            <p className="mt-1 text-xs text-violet-700">
                              {language === "th"
                                ? "หน้านี้มีไว้เพื่อตรวจระยะทางและจับคู่ Fuel Logs กับงาน ไม่ใช่สร้างเส้นทางใหม่"
                                : "Use this page to verify distance and match Fuel Logs to the job — not to rebuild the booking route."}
                            </p>
                          </div>

                          <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
                            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">
                              {language === "th" ? "การแก้ไขเส้นทางสำหรับผู้ดูแลระบบ" : "Admin route override"}
                            </summary>
                            <div className="border-t border-slate-200 bg-white p-4">
                              <p className="mb-3 text-xs text-slate-500">
                                {language === "th"
                                  ? "ใช้เฉพาะเมื่อข้อมูลเส้นทางจาก Booking Diary ไม่ถูกต้องหรือจำเป็นต้องแก้ระยะทางด้วยตนเอง"
                                  : "Only use these controls when the Booking Diary route is wrong or the distance needs a manual correction."}
                              </p>
                              <button
                                type="button"
                                onClick={() => void handleCalculateRouteDistance()}
                                disabled={calculatingDistance}
                                className="btn-secondary mb-4 min-h-10 px-4 py-2 text-sm"
                              >
                                {calculatingDistance
                                  ? copy.calculating
                                  : form.route_calculated_at
                                    ? copy.refreshRoute
                                    : copy.calculateRouteDistance}
                              </button>
                              <div className="grid gap-3 md:grid-cols-2">
                              <div className="form-field">
                                <label className="form-label">{copy.manualEstimatedOverride}</label>
                                <input
                                  ref={manualEstimatedKmRef}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={form.manual_estimated_distance_km}
                                  onChange={(event) => updateForm("manual_estimated_distance_km", event.target.value)}
                                  className="form-input bg-white"
                                />
                              </div>
                              <div className="form-field">
                                <label className="form-label">{copy.manualActualKm}</label>
                                <input
                                  ref={manualActualKmRef}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={form.manual_actual_km}
                                  onChange={(event) => updateForm("manual_actual_km", event.target.value)}
                                  className="form-input bg-white"
                                />
                              </div>
                              <div className="form-field">
                                <label className="form-label">{copy.startMileage}</label>
                                <input type="number" min="0" value={form.start_mileage} onChange={(event) => updateForm("start_mileage", event.target.value)} className="form-input bg-white" />
                              </div>
                              <div className="form-field">
                                <label className="form-label">{copy.endMileage}</label>
                                <input type="number" min="0" value={form.end_mileage} onChange={(event) => updateForm("end_mileage", event.target.value)} className="form-input bg-white" />
                              </div>
                              </div>
                            </div>
                          </details>
                        </section>

                        <div className="flex justify-end">
                          <button type="button" onClick={() => setReviewStep(2)} className="btn-primary min-h-11 px-5 py-2.5">
                            {language === "th" ? "ต่อไป: เชื้อเพลิงและระยะทาง →" : "Continue to Fuel & Mileage →"}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {reviewStep === 2 ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-2xl border border-violet-100 bg-white p-4">
                            <p className="text-xs font-semibold text-slate-500">{language === "th" ? "ระยะทางแผน" : "Planned"}</p>
                            <p className="mt-1 text-2xl font-black text-slate-950">{formatNumber(selectedFormMetrics?.estimatedDistance)} km</p>
                          </div>
                          <div className="rounded-2xl border border-emerald-100 bg-white p-4">
                            <p className="text-xs font-semibold text-slate-500">{language === "th" ? "ระยะทางใช้งาน" : "Working / actual"}</p>
                            <p className="mt-1 text-2xl font-black text-slate-950">{formatNumber(selectedFormMetrics?.workingDistance)} km</p>
                          </div>
                          <div className="rounded-2xl border border-amber-100 bg-white p-4">
                            <p className="text-xs font-semibold text-slate-500">{copy.difference}</p>
                            <p className="mt-1 text-2xl font-black text-slate-950">{formatNumber(selectedFormMetrics?.differenceKm)} km</p>
                          </div>
                        </div>

                        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">
                                {language === "th" ? "ตรวจระยะทาง" : "Mileage check"}
                              </p>
                              <h3 className="mt-1 text-lg font-black text-slate-950">
                                {mileageVerified ? (language === "th" ? "ระยะทางยืนยันแล้ว" : "Mileage verified") : (language === "th" ? "ต้องตรวจระยะทาง" : "Mileage needs checking")}
                              </h3>
                            </div>
                            <span className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                              mileageVerified
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                            }`}>
                              {mileageVerified
                                ? (language === "th" ? "ยืนยันแล้ว" : "Verified")
                                : (language === "th" ? "ต้องตรวจสอบ" : "Needs review")}
                            </span>
                          </div>

                          <details className={`mt-4 rounded-xl border ${
                            mileageVerified ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50/50"
                          }`}>
                            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">
                              {language === "th" ? "ปรับระยะทางด้วยตนเอง" : "Manual mileage adjustment"}
                              <span className="ml-2 text-xs font-normal text-slate-400">
                                {language === "th" ? "(ใช้เมื่อจำเป็น)" : "(only when needed)"}
                              </span>
                            </summary>
                            <div className="grid gap-3 border-t border-slate-200 bg-white p-4 md:grid-cols-3">
                              <div className="form-field">
                                <label className="form-label">{copy.startMileage}</label>
                                <input type="number" min="0" value={form.start_mileage} onChange={(event) => updateForm("start_mileage", event.target.value)} className="form-input bg-white" />
                              </div>
                              <div className="form-field">
                                <label className="form-label">{copy.endMileage}</label>
                                <input type="number" min="0" value={form.end_mileage} onChange={(event) => updateForm("end_mileage", event.target.value)} className="form-input bg-white" />
                              </div>
                              <div className="form-field">
                                <label className="form-label">{copy.manualActualKm}</label>
                                <input type="number" min="0" step="0.01" value={form.manual_actual_km} onChange={(event) => updateForm("manual_actual_km", event.target.value)} className="form-input bg-white" />
                              </div>
                            </div>
                          </details>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">
                                {language === "th" ? "บันทึกเชื้อเพลิง" : "Fuel records"}
                              </p>
                              <h3 className="mt-1 text-lg font-black text-slate-950">
                                {fuelChecked ? (language === "th" ? "ตรวจเชื้อเพลิงแล้ว" : "Fuel check complete") : (language === "th" ? "ต้องตรวจเชื้อเพลิง" : "Fuel check required")}
                              </h3>
                              <p className="mt-1 text-xs text-slate-500">
                                {language === "th"
                                  ? "Fuel logs ใช้ตรวจรอบเชื้อเพลิงและระยะทาง ไม่ถือว่าเป็นเชื้อเพลิงของทริปเดียวโดยตรง"
                                  : "Fuel logs support fuel-cycle and mileage checking; they are not treated as exact fuel use for one trip."}
                              </p>
                            </div>
                            {!fuelChecked ? (
                              <button type="button" onClick={() => void handleManualFuelConfirm()} className="btn-secondary min-h-10 px-4 py-2 text-sm">
                                {language === "th" ? "ยืนยันการตรวจเชื้อเพลิง" : "Confirm fuel check"}
                              </button>
                            ) : null}
                          </div>

                          <div className="mt-4 space-y-2">
                            {selectedTrip.linkedFuelLogs.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                                {copy.noFuelLogsLinkedYet}
                              </div>
                            ) : null}
                            {selectedTrip.linkedFuelLogs.map((log) => (
                              <div key={log.id} className="flex flex-col gap-3 rounded-xl border border-emerald-100 bg-emerald-50/35 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-black text-slate-950">
                                    {formatDate(log.date)} · {log.vehicle_reg} · {log.driver}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-600">
                                    {formatNumber(Number(log.litres || 0), 2)} L · {formatCurrency(Number(log.total_cost || 0))}
                                    {log.mileage ? ` · ${formatNumber(Number(log.mileage))} km` : ""}
                                    {log.station || log.location ? ` · ${log.station || log.location}` : ""}
                                  </p>
                                </div>
                                <button type="button" onClick={() => void handleUnlinkFuelLog(String(log.id))} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
                                  {copy.unlink}
                                </button>
                              </div>
                            ))}
                          </div>

                          {selectedPossibleFuelLogs.length > 0 ? (
                            <div className="mt-4">
                              <p className="text-xs font-black uppercase tracking-[0.1em] text-amber-700">
                                {language === "th" ? "บันทึกที่อาจตรงกัน" : "Possible matches"}
                              </p>
                              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                                {selectedPossibleFuelLogs.slice(0, 4).map((log) => (
                                  <div key={log.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-bold text-slate-950">{formatDate(log.date)} · {log.vehicle_reg} · {log.driver}</p>
                                      <p className="text-xs text-slate-600">
                                        {formatNumber(Number(log.litres || 0), 2)} L · {formatCurrency(Number(log.total_cost || 0))}
                                      </p>
                                    </div>
                                    <button type="button" onClick={() => void handleLinkFuelLog(String(log.id))} className="btn-primary min-h-8 px-3 py-1 text-xs">
                                      {language === "th" ? "เชื่อม" : "Link"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button type="button" onClick={() => setManualFuelExpanded((current) => !current)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
                              {manualFuelExpanded ? (language === "th" ? "ซ่อนการค้นหา" : "Hide fuel search") : (language === "th" ? "ค้นหา Fuel Logs อื่น" : "Search other Fuel Logs")}
                            </button>
                          </div>

                          {manualFuelExpanded ? (
                            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <div className="grid gap-2 sm:grid-cols-2">
                                <input value={manualFuelSearch} onChange={(event) => setManualFuelSearch(event.target.value)} placeholder={copy.searchFuelPlaceholder} className="form-input bg-white" />
                                <input type="date" value={manualFuelDate} onChange={(event) => setManualFuelDate(event.target.value)} className="form-input bg-white" />
                              </div>
                              <div className="mt-3 max-h-[240px] space-y-2 overflow-y-auto pr-1">
                                {manualFuelLogOptions.length === 0 ? <p className="text-sm text-slate-500">{copy.noOtherFuelLogs}</p> : null}
                                {manualFuelLogOptions.map((log) => (
                                  <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-bold text-slate-950">{formatDate(log.date)} · {log.vehicle_reg} · {log.driver}</p>
                                      <p className="text-xs text-slate-500">{formatNumber(Number(log.litres || 0), 2)} L · {formatCurrency(Number(log.total_cost || 0))}</p>
                                    </div>
                                    <button type="button" onClick={() => void handleLinkFuelLog(String(log.id))} className="btn-secondary min-h-8 px-3 py-1 text-xs">
                                      {language === "th" ? "เชื่อม" : "Link"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {(selectedFuelCycle || selectedIncompleteFuelLog) ? (
                            <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
                              <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">
                                {language === "th" ? "ดูรายละเอียดรอบเชื้อเพลิง" : "View fuel-cycle details"}
                              </summary>
                              <div className="border-t border-slate-200 bg-white p-4 text-sm text-slate-600">
                                {selectedFuelCycle ? (
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                    <div><p className="text-xs text-slate-400">{copy.fuelCycleDistance}</p><p className="font-bold text-slate-950">{formatNumber(selectedFuelCycle.distanceKm)} km</p></div>
                                    <div><p className="text-xs text-slate-400">{copy.linkedTripDistanceInCycle}</p><p className="font-bold text-slate-950">{formatNumber(selectedFuelCycleCoverage?.linkedDistance)} km</p></div>
                                    <div><p className="text-xs text-slate-400">{copy.unallocatedDistance}</p><p className="font-bold text-slate-950">{formatNumber(selectedFuelCycleCoverage?.unallocatedDistance)} km</p></div>
                                    <div><p className="text-xs text-slate-400">{copy.coverage}</p><p className="font-bold text-slate-950">{formatNumber(selectedFuelCycleCoverage?.coveragePercent, 1)}%</p></div>
                                  </div>
                                ) : (
                                  <p>{selectedFuelCycleState.status}</p>
                                )}
                              </div>
                            </details>
                          ) : null}
                        </section>

                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <button type="button" onClick={() => setReviewStep(1)} className="btn-secondary min-h-11 px-5 py-2.5">
                            ← {language === "th" ? "กลับไปทริป" : "Back to Trip"}
                          </button>
                          <button type="button" onClick={() => setReviewStep(3)} className="btn-primary min-h-11 px-5 py-2.5">
                            {language === "th" ? "ต่อไป: ตรวจสอบ →" : "Continue to Verify →"}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {reviewStep === 3 ? (
                      <div className="space-y-4">
                        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">
                              {language === "th" ? "ตรวจสอบสุดท้าย" : "Final verification"}
                            </p>
                            <h3 className="mt-1 text-xl font-black text-slate-950">
                              {language === "th" ? "พร้อมยืนยันทริปนี้หรือไม่?" : "Is this trip ready to verify?"}
                            </h3>
                          </div>

                          <div className={`mt-4 rounded-xl border px-4 py-3 ${
                            bookingLinked && distanceReady && mileageVerified && fuelChecked
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-amber-200 bg-amber-50"
                          }`}>
                            <p className={`font-black ${
                              bookingLinked && distanceReady && mileageVerified && fuelChecked
                                ? "text-emerald-800"
                                : "text-amber-800"
                            }`}>
                              {bookingLinked && distanceReady && mileageVerified && fuelChecked
                                ? (language === "th" ? "พร้อมยืนยันทริป" : "Ready to verify")
                                : (language === "th" ? "ยังมีรายการที่ต้องตรวจสอบ" : "Items still need attention")}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-600">
                              {bookingLinked && distanceReady && mileageVerified && fuelChecked
                                ? (language === "th" ? "Booking, route, mileage และ fuel check ครบแล้ว" : "Booking, route, mileage and fuel checks are complete.")
                                : (language === "th" ? "ตรวจรายการสีเหลืองก่อนยืนยันทริป" : "Review any amber checks before verifying the trip.")}
                            </p>
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {[
                              {
                                label: language === "th" ? "เชื่อม Booking" : "Booking linked",
                                ok: bookingLinked
                              },
                              {
                                label: language === "th" ? "เส้นทาง / ระยะทาง" : "Route & distance",
                                ok: distanceReady
                              },
                              {
                                label: language === "th" ? "ระยะทางยืนยัน" : "Mileage verified",
                                ok: mileageVerified
                              },
                              {
                                label: language === "th" ? "ตรวจเชื้อเพลิง" : "Fuel checked",
                                ok: fuelChecked
                              }
                            ].map((check) => (
                              <div key={check.label} className={`rounded-xl border p-4 ${
                                check.ok
                                  ? "border-emerald-200 bg-emerald-50"
                                  : "border-amber-200 bg-amber-50"
                              }`}>
                                <p className={`text-sm font-black ${check.ok ? "text-emerald-800" : "text-amber-800"}`}>
                                  {check.ok ? "✓ " : "⚠ "}{check.label}
                                </p>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">
                            {language === "th" ? "หมายเหตุ (ไม่บังคับ)" : "Optional notes"}
                          </p>
                          <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            <div className="form-field">
                              <label className="form-label">{copy.waitingIdleNotes}</label>
                              <textarea rows={4} value={form.waiting_idle_notes} onChange={(event) => updateForm("waiting_idle_notes", event.target.value)} className="form-textarea bg-white" />
                            </div>
                            <div className="form-field">
                              <label className="form-label">{copy.extraRouteNotes}</label>
                              <textarea rows={4} value={form.extra_route_notes} onChange={(event) => updateForm("extra_route_notes", event.target.value)} className="form-textarea bg-white" />
                            </div>
                          </div>
                        </section>

                        <section className="rounded-2xl border border-violet-100 bg-violet-50/45 p-4">
                          <div className="grid gap-3 md:grid-cols-4">
                            <div>
                              <p className="text-xs text-slate-500">{copy.route}</p>
                              <p className="mt-1 truncate font-bold text-slate-950">{getShortRoutePreview(selectedTrip, copy)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">{language === "th" ? "ระยะทางแผน" : "Planned"}</p>
                              <p className="mt-1 font-bold text-slate-950">{formatNumber(selectedFormMetrics?.estimatedDistance)} km</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">{language === "th" ? "ระยะทางใช้งาน" : "Working"}</p>
                              <p className="mt-1 font-bold text-slate-950">{formatNumber(selectedFormMetrics?.workingDistance)} km</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">{copy.fuelStatus}</p>
                              <p className="mt-1 font-bold text-slate-950">{getFuelStatusLabel(selectedFuelStatus, copy)}</p>
                            </div>
                          </div>
                        </section>

                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setReviewStep(2)} className="btn-secondary min-h-11 px-5 py-2.5">
                              ← {language === "th" ? "กลับไปเชื้อเพลิงและระยะทาง" : "Back to Fuel & Mileage"}
                            </button>
                            <details className="relative">
                              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                                {language === "th" ? "การดำเนินการเพิ่มเติม" : "More actions"}
                              </summary>
                              <div className="absolute bottom-12 left-0 z-20 min-w-[180px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                                <button
                                  type="button"
                                  onClick={() => requestDeleteTrip(selectedTrip)}
                                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-rose-700 hover:bg-rose-50"
                                >
                                  {copy.deleteTrip}
                                </button>
                              </div>
                            </details>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            <button type="button" onClick={closeTripReview} className="btn-secondary min-h-11 px-4 py-2.5">
                              {language === "th" ? "ปิด" : "Close"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveTrip()}
                              disabled={saving}
                              className="btn-primary min-h-11 px-6 py-2.5"
                            >
                              <Save className="h-4 w-4" />
                              {saving
                                ? copy.saving
                                : language === "th"
                                  ? "ยืนยันทริป"
                                  : "Verify Trip"}
                            </button>
                          </div>
                        </div>

                        <p className={`text-right text-xs font-semibold ${hasUnsavedChanges ? "text-amber-700" : "text-emerald-700"}`}>
                          {hasUnsavedChanges ? copy.unsavedChanges : notice === copy.tripSavedSuccessfully ? copy.tripSavedSuccessfully : copy.noUnsavedChanges}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </>
              );
            })()}
          </section>
        </div>
      ) : null}

      <section className="hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{copy.performanceComparison}</h3>
            <p className="section-subtitle">{copy.comparisonDescription}</p>
          </div>
          <select value={comparisonSort} onChange={(event) => setComparisonSort(event.target.value as ComparisonSort)} className="form-input w-full bg-white sm:w-56">
            <option value="best_kml">{copy.sortBestKmL}</option>
            <option value="worst_kml">{copy.sortWorstKmL}</option>
            <option value="lowest_cost_per_km">{copy.sortLowestCostKm}</option>
            <option value="highest_fuel_cost">{copy.sortHighestFuelCost}</option>
            <option value="lowest_fuel_cost">{copy.sortLowestFuelCost}</option>
            <option value="most_actual_km">{copy.sortMostActualKm}</option>
            <option value="least_actual_km">{copy.sortShortestTrip}</option>
            <option value="most_completed_trips">{copy.sortMostCompletedTrips}</option>
            <option value="most_accurate">{copy.sortMostAccurate}</option>
            <option value="least_accurate">{copy.sortLeastAccurate}</option>
          </select>
        </div>

        {summary.verifiedTrips < 5 ? <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">{copy.moreCompletedTripsNeeded}</p> : null}
        {summary.completedTrips > summary.verifiedTrips ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{copy.comparisonNeedsChecksHelper}</p> : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className={metricTileClass("slate")}><p className="text-xs font-semibold opacity-80">{copy.completedTripsLabel}</p><p className="text-xl font-bold text-slate-950">{summary.completedTrips}</p></div>
          <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.verifiedDataCheckedTrips}</p><p className="text-xl font-bold text-slate-950">{summary.verifiedTrips}</p></div>
          <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.totalWorkingKm}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.completedWorkingKm)} km</p></div>
          <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.verifiedWorkingKm}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.verifiedWorkingKm)} km</p></div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.bestKmLDriver}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.bestDriverByKmPerLitre?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.bestDriverByKmPerLitre?.actualKm)} km</p></div>
          <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.lowestCostKmDriver}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.lowestCostDriver?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.lowestCostDriver?.averageDifferenceKm)} km</p></div>
          <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.bestVehicle}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.bestVehicleByKmPerLitre?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.bestVehicleByKmPerLitre?.actualKm)} km</p></div>
          <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.lowestVehicleCostKm}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.lowestCostVehicle?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.lowestCostVehicle?.averageDifferenceKm)} km</p></div>
          <div className={metricTileClass("amber")}><p className="text-xs font-semibold opacity-80">{copy.mostExpensiveTrip}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.mostExpensiveTrip ? getShortRoutePreview(summary.mostExpensiveTrip.trip, copy) : "-"}</p><p className="text-xs text-slate-500">{summary.mostExpensiveTrip ? copy.belongsToFuelCycle : copy.notAssignedToFuelCycle}</p></div>
          <div className={metricTileClass("amber")}><p className="text-xs font-semibold opacity-80">{copy.biggestDistanceDifference}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.biggestDistanceDifference ? getShortRoutePreview(summary.biggestDistanceDifference.trip, copy) : "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.biggestDistanceDifference?.metrics.differenceKm)} km</p></div>
        </div>

        {summary.dataQualityNotes.length > 0 ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-bold text-amber-900">{copy.dataQuality}</p>
            <div className="mt-2 flex flex-wrap gap-2">{summary.dataQualityNotes.map((note) => <span key={note} className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-amber-800">{note}</span>)}</div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ["drivers", copy.drivers],
            ["vehicles", copy.vehicles],
            ["routes", copy.routes],
            ["trips", copy.trips]
          ].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setComparisonTab(key as ComparisonTab)} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${comparisonTab === key ? "border-brand-200 bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{label}</button>
          ))}
        </div>

        {(comparisonTab === "drivers" || comparisonTab === "vehicles") ? (
          <div className="mt-4">
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">{copy.rank}</th><th className="px-3 py-3 text-left">{comparisonTab === "drivers" ? copy.driver : copy.vehicleRegistration}</th><th className="px-3 py-3 text-right">{copy.completedTripsLabel}</th><th className="px-3 py-3 text-right">{copy.verifiedDataCheckedTrips}</th><th className="px-3 py-3 text-right">{copy.totalWorkingKm}</th><th className="px-3 py-3 text-right">{copy.verifiedWorkingKm}</th><th className="px-3 py-3 text-right">{copy.avgDifference}</th><th className="px-3 py-3 text-right">{copy.estimatedVsActual}</th><th className="px-3 py-3 text-left">{copy.label}</th></tr></thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {(comparisonTab === "drivers" ? sortedDriverRows : sortedVehicleRows).map((row, index) => <tr key={row.name} className="transition hover:bg-brand-50/45"><td className="px-3 py-3 font-bold text-slate-950">#{index + 1}</td><td className="px-3 py-3 font-bold text-slate-950">{row.name}</td><td className="px-3 py-3 text-right font-semibold">{row.completedTrips}</td><td className="px-3 py-3 text-right font-semibold text-emerald-700">{row.verifiedTrips}</td><td className="px-3 py-3 text-right">{formatNumber(row.totalWorkingKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.verifiedWorkingKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageDifferenceKm)}</td><td className="px-3 py-3 text-right">{row.estimatedKm > 0 ? `${formatNumber(((row.actualKm - row.estimatedKm) / row.estimatedKm) * 100, 1)}%` : "-"}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel, copy)}`}>{row.performanceLabel}</span></td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:hidden">
              {(comparisonTab === "drivers" ? sortedDriverRows : sortedVehicleRows).map((row, index) => <article key={row.name} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">#{index + 1}</p><h4 className="mt-1 font-bold text-slate-950">{row.name}</h4></div><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel, copy)}`}>{row.performanceLabel}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">{copy.completedTripsLabel}</p><p className="font-bold">{row.completedTrips}</p></div><div><p className="text-xs text-slate-500">{copy.verifiedDataCheckedTrips}</p><p className="font-bold text-emerald-700">{row.verifiedTrips}</p></div><div><p className="text-xs text-slate-500">{copy.totalWorkingKm}</p><p className="font-bold">{formatNumber(row.totalWorkingKm)}</p></div><div><p className="text-xs text-slate-500">{copy.verifiedWorkingKm}</p><p className="font-bold">{formatNumber(row.verifiedWorkingKm)}</p></div></div></article>)}
            </div>
          </div>
        ) : null}

        {comparisonTab === "routes" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">{copy.route}</th><th className="px-3 py-3 text-right">{copy.trips}</th><th className="px-3 py-3 text-right">{copy.avgEstKm}</th><th className="px-3 py-3 text-right">{copy.workingDistance}</th><th className="px-3 py-3 text-right">{copy.avgDifference}</th><th className="px-3 py-3 text-left">{copy.label}</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{sortedRouteRows.map((row) => <tr key={row.route} className="transition hover:bg-brand-50/45"><td className="max-w-[280px] px-3 py-3 font-bold text-slate-950"><span className="line-clamp-2">{row.route}</span></td><td className="px-3 py-3 text-right">{row.completedTrips}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageEstimatedKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageActualKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageDifferenceKm)}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel, copy)}`}>{row.performanceLabel}</span></td></tr>)}</tbody></table></div>
        ) : null}

        {comparisonTab === "trips" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">{copy.date}</th><th className="px-3 py-3 text-left">{copy.route}</th><th className="px-3 py-3 text-left">{copy.driver}</th><th className="px-3 py-3 text-left">{copy.vehicle}</th><th className="px-3 py-3 text-right">{copy.workingDistance}</th><th className="px-3 py-3 text-right">{copy.estimatedKm}</th><th className="px-3 py-3 text-right">{copy.difference}</th><th className="px-3 py-3 text-left">{copy.distanceSource}</th><th className="px-3 py-3 text-left">{copy.label}</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{sortedTripRows.map((row) => <tr key={row.trip.id} className="transition hover:bg-brand-50/45"><td className="px-3 py-3">{formatDate(row.trip.trip_date)}</td><td className="max-w-[260px] px-3 py-3 font-bold text-slate-950"><span className="line-clamp-2">{getShortRoutePreview(row.trip, copy)}</span></td><td className="px-3 py-3">{row.trip.driver || "-"}</td><td className="px-3 py-3">{row.trip.vehicle_reg || row.trip.vehicle_type || "-"}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.workingDistance)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.estimatedDistance)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.differenceKm)}</td><td className="px-3 py-3">{row.metrics.distanceSource}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.label, copy)}`}>{row.label}</span></td></tr>)}</tbody></table></div>
        ) : null}
      </section>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-rose-50 p-2 text-rose-700">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-950">{copy.deleteTripQuestion}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {copy.deleteTripDescription}
                </p>
                <p className="mt-2 text-xs font-semibold text-slate-500">{deleteTarget.label}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="btn-secondary justify-center">
                {copy.cancel}
              </button>
              <button type="button" onClick={() => void handleConfirmDeleteTrip()} disabled={deleting} className="min-h-10 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60">
                {deleting ? copy.deleting : copy.deleteTrip}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
