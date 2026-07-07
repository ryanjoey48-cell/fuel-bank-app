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
import {
  createTripJourneyFromBooking,
  deleteTripJourney,
  fetchBookingDiaryEntries,
  fetchFuelLogs,
  fetchDrivers,
  fetchTripJourneys,
  fetchVehicles,
  linkFuelLogToTrip,
  saveTripJourney,
  unlinkFuelLogFromTrip
} from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import type { Driver, FuelLogWithDriver, TripFuelSource, TripJourneyWithFuel, Vehicle } from "@/types/database";

const DEPOT_ADDRESS =
  "Expert Express Sender Co., Ltd. 88 Happy Place, Khwaeng Khlong Sam Prawet, Khet Lat Krabang, Bangkok 10520, Thailand";

const tripJourneyCopy = {
  en: {
    tripJourney: "Trip Journey",
    tripPerformance: "Trip Performance",
    description: "Compare booking routes against actual mileage and fuel usage by driver, vehicle, and route.",
    refresh: "Refresh",
    tripStatus: "Trip Status",
    operationsOverview: "Operations Overview",
    tripsCompleted: "Trips completed",
    tripsInProgress: "Trips in progress",
    overallCompletion: "Overall completion",
    fleetPerformance: "Fleet Performance",
    fleetPerformanceHelper: "Completed trips, missing data, fuel readiness and route accuracy.",
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
    fuelUsedTrend: "Fuel Used",
    fuelCostTrend: "Fuel Cost",
    quickFilters: "Quick Filters",
    today: "Today",
    yesterday: "Yesterday",
    thisWeek: "This Week",
    thisMonth: "This Month",
    viewTrips: "View Trips",
    view: "View",
    edit: "Edit",
    openBooking: "Open Booking",
    openFuelLogs: "Open Fuel Logs",
    completion: "Completion",
    vehicleRegistration: "Registration",
    estimatedVsActual: "Estimated vs Actual %",
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
    missingFuel: "Missing fuel",
    missingFuelTitle: "Missing Fuel",
    created: "Created",
    distanceFuel: "Distance & Fuel",
    actualKm: "Actual KM",
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
    filtersDescription: "Date, driver, vehicle, route, data status and fuel link.",
    allDrivers: "All drivers",
    allVehicles: "All vehicles",
    route: "Route",
    allData: "All data",
    missingDataOnly: "Missing data only",
    completedOnly: "Completed only",
    allFuelLinks: "All fuel links",
    fuelLogsLinked: "Fuel logs linked",
    fuelLogsNotLinked: "Fuel logs not linked",
    resetFilters: "Reset filters",
    needsAttention: "Needs Attention",
    needsAttentionDescription: "Select a missing item to focus the trip list.",
    actualKmNeeded: "Actual KM is needed for efficiency.",
    comparePlannedActual: "Compare planned vs actual route.",
    linkFuelLogsOrManual: "Link fuel logs or enter manually.",
    showAllTrips: "Show all trips",
    tripRecords: "Trip Records",
    tripRecordsDescription: "Compact list of booking journeys. Review one trip to edit details.",
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
    fuelLogs: "Fuel Logs",
    noneLinked: "None linked",
    linked: "linked",
    noFuel: "No fuel",
    noFuelCost: "No fuel cost",
    nextAction: "Next action",
    manageFuelLogs: "Manage fuel logs",
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
    actualDistance: "Actual Distance",
    manualActualKm: "Manual actual KM",
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
    linkedFuelLogs: "Linked Fuel Logs",
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
    performanceComparison: "Performance Comparison",
    comparisonDescription: "Completed trips only are used for efficiency averages. Completed = actual km, estimated km, fuel litres and fuel cost are all present.",
    sortBestKmL: "Sort: Best KM/L",
    sortLowestCostKm: "Sort: Lowest cost/km",
    sortHighestFuelCost: "Sort: Highest fuel cost",
    sortMostActualKm: "Sort: Most actual km",
    sortMostCompletedTrips: "Sort: Most completed trips",
    sortWorstKmL: "Sort: Worst KM/L",
    sortLowestFuelCost: "Sort: Lowest fuel cost",
    sortLongestTrip: "Sort: Longest trip",
    sortShortestTrip: "Sort: Shortest trip",
    sortMostAccurate: "Sort: Most accurate",
    sortLeastAccurate: "Sort: Least accurate",
    moreCompletedTripsNeeded: "More completed trips are needed for reliable comparison.",
    bestKmLDriver: "Best KM/L driver",
    lowestCostKmDriver: "Lowest cost/km driver",
    bestVehicle: "Best vehicle",
    lowestVehicleCostKm: "Lowest vehicle cost/km",
    mostExpensiveTrip: "Most expensive trip",
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
    avgFuelCost: "Avg fuel cost",
    deleteTripQuestion: "Delete trip?",
    deleteTripDescription: "This will delete the trip journey record only. It will not delete the original Booking Diary entry or any Fuel Logs.",
    cancel: "Cancel",
    deleting: "Deleting...",
    reviewPerformance: "Review performance",
    addActualKm: "Add actual km",
    addEstimate: "Add estimate",
    reviewDetails: "Review details",
    missingMileageHelper: "Actual KM is required before efficiency can be calculated.",
    missingEstimateHelper: "Estimated KM lets you compare planned vs actual distance.",
    missingFuelHelper: "Link fuel logs or enter manual fuel to complete this trip.",
    completedHelper: "This trip is complete and included in performance comparison.",
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
    dataQualityEstimateNoActual: "Some trips have estimates but no actual km.",
    dataQualityActualNoFuel: "Some trips have actual km but no active fuel data.",
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
  },
  th: {
    tripJourney: "เส้นทางการเดินทาง",
    tripPerformance: "ประสิทธิภาพการเดินทาง",
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
    missingFuel: "ขาดข้อมูลน้ำมัน",
    missingFuelTitle: "ขาดข้อมูลน้ำมัน",
    created: "สร้างแล้ว",
    distanceFuel: "ระยะทางและน้ำมัน",
    actualKm: "กม. จริง",
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
    actualKmNeeded: "ต้องมี กม. จริงเพื่อคำนวณประสิทธิภาพ",
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
    fuelLogs: "บันทึกน้ำมัน",
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
    manualActualKm: "กม. จริงที่กรอกเอง",
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
    linkedFuelLogs: "บันทึกน้ำมันที่เชื่อมโยง",
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
    performanceComparison: "การเปรียบเทียบประสิทธิภาพ",
    comparisonDescription: "ใช้เฉพาะทริปที่เสร็จสิ้นในการคำนวณค่าเฉลี่ยประสิทธิภาพ เสร็จสิ้น = มี กม. จริง กม. ประมาณการ ลิตรน้ำมัน และค่าน้ำมันครบ",
    sortBestKmL: "เรียง: กม./ลิตร ดีที่สุด",
    sortLowestCostKm: "เรียง: ค่าใช้จ่าย/กม. ต่ำสุด",
    sortHighestFuelCost: "เรียง: ค่าน้ำมันสูงสุด",
    sortMostActualKm: "เรียง: กม. จริงมากที่สุด",
    sortMostCompletedTrips: "เรียง: ทริปเสร็จสิ้นมากที่สุด",
    moreCompletedTripsNeeded: "ต้องมีทริปที่เสร็จสิ้นมากกว่านี้เพื่อเปรียบเทียบให้แม่นยำ",
    bestKmLDriver: "พนักงานขับรถ กม./ลิตร ดีที่สุด",
    lowestCostKmDriver: "พนักงานขับรถค่าใช้จ่าย/กม. ต่ำสุด",
    bestVehicle: "รถดีที่สุด",
    lowestVehicleCostKm: "รถค่าใช้จ่าย/กม. ต่ำสุด",
    mostExpensiveTrip: "ทริปที่แพงที่สุด",
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
    avgFuelCost: "ค่าน้ำมันเฉลี่ย",
    deleteTripQuestion: "ลบทริปนี้?",
    deleteTripDescription: "จะลบเฉพาะรายการทริปนี้ ไม่ลบรายการจองเดิมหรือบันทึกน้ำมัน",
    cancel: "ยกเลิก",
    deleting: "กำลังลบ...",
    reviewPerformance: "ตรวจสอบประสิทธิภาพ",
    addActualKm: "เพิ่ม กม. จริง",
    addEstimate: "เพิ่มระยะทางประมาณการ",
    reviewDetails: "ตรวจสอบรายละเอียด",
    missingMileageHelper: "ต้องมี กม. จริงก่อนคำนวณประสิทธิภาพ",
    missingEstimateHelper: "กม. ประมาณการช่วยเปรียบเทียบแผนกับระยะจริง",
    missingFuelHelper: "เชื่อมโยงบันทึกน้ำมันหรือกรอกน้ำมันเองเพื่อให้ทริปครบถ้วน",
    completedHelper: "ทริปนี้ครบถ้วนและรวมอยู่ในการเปรียบเทียบประสิทธิภาพ",
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
  }
} as const;

type TripJourneyCopy = { [K in keyof (typeof tripJourneyCopy)["en"]]: string };

const tripJourneyCopyOverrides: Partial<Record<keyof typeof tripJourneyCopy, Partial<TripJourneyCopy>>> = {
  th: {
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
    routeCalculateFailed: "ไม่สามารถคำนวณระยะทางได้ คุณสามารถกรอก กม. ประมาณการเองแทนได้"
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
  booking_estimated_km: string;
  booking_estimated_minutes: string;
  booking_google_maps_route_url: string;
  manual_estimated_distance_km: string;
  manual_litres_used: string;
  manual_fuel_cost: string;
  fuel_source: TripFuelSource;
  waiting_idle_notes: string;
  extra_route_notes: string;
};

type SelectedTripTab = "overview" | "journey" | "fuel" | "notes";
type AttentionFilter = "all" | "missing_mileage" | "missing_estimate" | "missing_fuel";
type DerivedTripStatus = "completed" | "missing_mileage" | "missing_estimated_distance" | "missing_fuel";
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

type DistanceEstimateResponse = {
  distanceKm?: number;
  durationSeconds?: number | null;
  provider?: string;
};

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
    (metrics.actualDistance ?? 0) > 0,
    (metrics.estimatedDistance ?? 0) > 0,
    hasValidActiveFuel(trip, metrics)
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
    booking_estimated_km: bookingEstimatedKm,
    booking_estimated_minutes: bookingEstimatedMinutes,
    booking_google_maps_route_url: trip.booking_google_maps_route_url ?? "",
    manual_estimated_distance_km: trip.manual_estimated_distance_km?.toString() ?? "",
    manual_litres_used: trip.manual_litres_used?.toString() ?? "",
    manual_fuel_cost: trip.manual_fuel_cost?.toString() ?? "",
    fuel_source: trip.fuel_source,
    waiting_idle_notes: trip.waiting_idle_notes ?? "",
    extra_route_notes: trip.extra_route_notes ?? ""
  };
}

function getActualDistance(trip: Pick<TripJourneyWithFuel, "start_mileage" | "end_mileage" | "manual_actual_km" | "actual_distance_km">) {
  if (trip.manual_actual_km != null && trip.manual_actual_km > 0) return trip.manual_actual_km;
  if (trip.start_mileage != null && trip.end_mileage != null && trip.end_mileage > trip.start_mileage) {
    return trip.end_mileage - trip.start_mileage;
  }
  if (trip.actual_distance_km != null && trip.actual_distance_km > 0) return trip.actual_distance_km;
  return null;
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
  const actualDistance = getActualDistance(trip);
  const estimatedDistance = getEstimatedDistance(trip);
  const fuel = getFuelTotals(trip);
  const differenceKm =
    actualDistance != null && estimatedDistance != null ? actualDistance - estimatedDistance : null;
  const differencePercent =
    differenceKm != null && estimatedDistance != null && estimatedDistance > 0
      ? (differenceKm / estimatedDistance) * 100
      : null;
  const kmPerLitre =
    actualDistance != null && fuel.litres != null && fuel.litres > 0 ? actualDistance / fuel.litres : null;
  const costPerKm =
    fuel.cost != null && actualDistance != null && actualDistance > 0 ? fuel.cost / actualDistance : null;

  return { actualDistance, estimatedDistance, fuel, differenceKm, differencePercent, kmPerLitre, costPerKm };
}

function hasValidActiveFuel(trip: TripJourneyWithFuel, metrics = getTripMetrics(trip)) {
  if (trip.fuel_source === "manual") {
    return (trip.manual_litres_used ?? 0) > 0 && (trip.manual_fuel_cost ?? 0) > 0;
  }
  return metrics.fuel.linkedLitres > 0 && metrics.fuel.linkedCost > 0;
}

function getDerivedTripStatus(trip: TripJourneyWithFuel): DerivedTripStatus {
  const metrics = getTripMetrics(trip);
  if ((metrics.actualDistance ?? 0) <= 0) return "missing_mileage";
  if ((metrics.estimatedDistance ?? 0) <= 0) return "missing_estimated_distance";
  if (!hasValidActiveFuel(trip, metrics)) return "missing_fuel";
  return "completed";
}

function isCompletedTrip(trip: TripJourneyWithFuel) {
  return getDerivedTripStatus(trip) === "completed";
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
  if (comparison.completedTrips < 2) return copy.needsMoreData;
  if (metrics.differencePercent != null && metrics.differencePercent > 15) return copy.overEstimate;
  if (comparison.averageCostPerKm != null && metrics.costPerKm != null && metrics.costPerKm > comparison.averageCostPerKm * 1.2) {
    return copy.highCostKm;
  }
  if (comparison.averageKmPerLitre != null && metrics.kmPerLitre != null && metrics.kmPerLitre < comparison.averageKmPerLitre * 0.8) {
    return copy.lowEfficiency;
  }
  return copy.good;
}

function getPerformanceLabel(row: Pick<PerformanceRow, "completedTrips" | "kmPerLitre" | "costPerKm">, bestKmPerLitre: number | null, lowestCostPerKm: number | null, copy: TripJourneyCopy = tripJourneyCopy.en) {
  if (row.completedTrips === 0) return copy.needsMoreData;
  if (bestKmPerLitre != null && row.kmPerLitre === bestKmPerLitre) return copy.bestKmL;
  if (lowestCostPerKm != null && row.costPerKm === lowestCostPerKm) return copy.lowestCostKm;
  return copy.average;
}

function sortPerformanceRows<T extends PerformanceRow>(rows: T[], sort: ComparisonSort) {
  const valueOrNullBottom = (value: number | null) => value == null ? Number.POSITIVE_INFINITY : value;
  const accuracyValue = (row: PerformanceRow) =>
    row.averageDifferenceKm == null ? Number.POSITIVE_INFINITY : Math.abs(row.averageDifferenceKm);
  const sorted = [...rows];
  if (sort === "lowest_cost_per_km") {
    return sorted.sort((a, b) => valueOrNullBottom(a.costPerKm) - valueOrNullBottom(b.costPerKm));
  }
  if (sort === "worst_kml") {
    return sorted.sort((a, b) => valueOrNullBottom(a.kmPerLitre) - valueOrNullBottom(b.kmPerLitre));
  }
  if (sort === "highest_fuel_cost") {
    return sorted.sort((a, b) => b.cost - a.cost);
  }
  if (sort === "lowest_fuel_cost") {
    return sorted.sort((a, b) => a.cost - b.cost);
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
  return sorted.sort((a, b) => (b.kmPerLitre ?? -1) - (a.kmPerLitre ?? -1));
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

function buildMapsDirectionsUrl(origin: string, destination: string, waypoints: string[] = []) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("travelmode", "driving");
  if (waypoints.length > 0) {
    url.searchParams.set("waypoints", waypoints.join("|"));
  }
  return url.toString();
}

function getTripRoutePlan(form: TripForm) {
  const startType = form.start_location_type;
  const depotAddress = form.depot_address.trim() || DEPOT_ADDRESS;
  const customStart = form.start_location.trim();
  const pickup = form.pickup_location.trim();
  const dropoff = form.dropoff_location.trim();

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

  return {
    startType,
    origin,
    destination,
    waypoints,
    depotAddress,
    customStart,
    pickup,
    dropoff,
    mapsUrl: buildMapsDirectionsUrl(origin, destination, waypoints)
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
  const actualDistance =
    manualActualKm != null && manualActualKm > 0
      ? manualActualKm
      : startMileage != null && endMileage != null && endMileage > startMileage
        ? endMileage - startMileage
        : null;
  const estimatedDistance = getEffectiveEstimatedKm(form);
  const linkedLitres = linkedFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const linkedCost = linkedFuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const fuelLitres = form.fuel_source === "manual" ? toNumber(form.manual_litres_used) : linkedLitres || null;
  const fuelCost = form.fuel_source === "manual" ? toNumber(form.manual_fuel_cost) : linkedCost || null;
  return {
    actualDistance,
    estimatedDistance,
    differenceKm: actualDistance != null && estimatedDistance != null ? actualDistance - estimatedDistance : null,
    fuelLitres,
    fuelCost,
    kmPerLitre: actualDistance != null && fuelLitres != null && fuelLitres > 0 ? actualDistance / fuelLitres : null,
    costPerKm: actualDistance != null && actualDistance > 0 && fuelCost != null ? fuelCost / actualDistance : null,
    actualSource: manualActualKm != null && manualActualKm > 0 ? copy.usingManualActualKm : startMileage != null && endMileage != null && endMileage > startMileage ? copy.usingMileageCalculation : copy.actualKmMissing
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

function isSuggestedFuelLog(trip: TripJourneyWithFuel, log: FuelLogWithDriver, linkedFuelLogIds: Set<string>) {
  if (linkedFuelLogIds.has(String(log.id))) return false;
  const sameVehicle = trip.vehicle_reg && log.vehicle_reg && trip.vehicle_reg === log.vehicle_reg;
  const sameDriver = trip.driver && log.driver && trip.driver.toLowerCase() === log.driver.toLowerCase();
  const tripDate = new Date(`${trip.trip_date}T00:00:00`).getTime();
  const fuelDate = new Date(`${log.date}T00:00:00`).getTime();
  if (!Number.isFinite(tripDate) || !Number.isFinite(fuelDate)) return false;
  const daysApart = Math.abs(tripDate - fuelDate) / (24 * 60 * 60 * 1000);
  return Boolean(daysApart <= 3 && (sameVehicle || (!trip.vehicle_reg && sameDriver)));
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
  const [trips, setTrips] = useState<TripJourneyWithFuel[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
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
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("all");
  const [visibleTripCount, setVisibleTripCount] = useState(10);
  const [comparisonTab, setComparisonTab] = useState<ComparisonTab>("drivers");
  const [comparisonSort, setComparisonSort] = useState<ComparisonSort>("best_kml");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedTripId(params.get("tripId") ?? params.get("trip"));
    setRequestedBookingId(params.get("bookingId") ?? params.get("booking"));
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [tripRows, fuelRows, driverRows, vehicleRows] = await Promise.all([
        fetchTripJourneys(),
        fetchFuelLogs(),
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

  const linkedFuelLogIds = useMemo(
    () => new Set(trips.flatMap((trip) => trip.linkedFuelLogs.map((log) => String(log.id)))),
    [trips]
  );
  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripId, trips]
  );
  const suggestedFuelLogs = useMemo(
    () =>
      selectedTrip
        ? fuelLogs
            .filter((log) => isSuggestedFuelLog(selectedTrip, log, linkedFuelLogIds))
            .sort((a, b) => getFuelLogMatchScore(selectedTrip, b) - getFuelLogMatchScore(selectedTrip, a))
        : [],
    [fuelLogs, linkedFuelLogIds, selectedTrip]
  );
  const manualFuelLogMatches = useMemo(() => {
    const query = manualFuelSearch.trim().toLowerCase();
    return fuelLogs
      .filter((log) => !linkedFuelLogIds.has(String(log.id)))
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
  }, [fuelLogs, linkedFuelLogIds, manualFuelDate, manualFuelSearch, selectedTrip, suggestedFuelLogs]);
  const manualFuelLogOptions = useMemo(
    () => manualFuelLogMatches.slice(0, visibleManualFuelLogCount),
    [manualFuelLogMatches, visibleManualFuelLogCount]
  );

  const baseFilteredTrips = useMemo(() => {
    return trips.filter((trip) => {
      const derivedStatus = getDerivedTripStatus(trip);
      const missing = derivedStatus !== "completed";
      return (
        (!filters.fromDate || trip.trip_date >= filters.fromDate) &&
        (!filters.toDate || trip.trip_date <= filters.toDate) &&
        (!filters.driver || trip.driver === filters.driver) &&
        (!filters.vehicle || trip.vehicle_reg === filters.vehicle) &&
        (!filters.route || (trip.route ?? "").toLowerCase().includes(filters.route.toLowerCase())) &&
        (filters.dataStatus === "all" || (filters.dataStatus === "missing" ? missing : derivedStatus === "completed")) &&
        (filters.fuelLink === "all" ||
          (filters.fuelLink === "linked" ? trip.linkedFuelLogs.length > 0 : trip.linkedFuelLogs.length === 0))
      );
    }).sort((a, b) => (b.trip_date || "").localeCompare(a.trip_date || ""));
  }, [filters, trips]);

  const filteredTrips = useMemo(() => {
    return baseFilteredTrips.filter((trip) => {
      const metrics = getTripMetrics(trip);
      if (attentionFilter === "missing_mileage") return (metrics.actualDistance ?? 0) <= 0;
      if (attentionFilter === "missing_estimate") return (metrics.estimatedDistance ?? 0) <= 0;
      if (attentionFilter === "missing_fuel") return !hasValidActiveFuel(trip, metrics);
      return true;
    });
  }, [attentionFilter, baseFilteredTrips]);

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
    const totalActual = baseFilteredTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).actualDistance ?? 0), 0);
    const totalEstimated = baseFilteredTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).estimatedDistance ?? 0), 0);
    const totalLitres = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.litres ?? 0), 0);
    const totalCost = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.cost ?? 0), 0);
    const completeMetrics = completed.map(getTripMetrics);
    const averageKmPerLitre =
      completeMetrics.length > 0
        ? completeMetrics.reduce((sum, metrics) => sum + (metrics.kmPerLitre ?? 0), 0) / completeMetrics.length
        : null;
    const completedActual = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).actualDistance ?? 0), 0);
    const completedCost = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.cost ?? 0), 0);
    const averageCostPerKm = completedActual > 0 && completedCost > 0 ? completedCost / completedActual : null;
    const averageDifference =
      completed.length > 0
        ? completed.reduce((sum, trip) => sum + (getTripMetrics(trip).differenceKm ?? 0), 0) / completed.length
        : null;
    const completionPercentage = baseFilteredTrips.length > 0
      ? Math.round((completed.length / baseFilteredTrips.length) * 100)
      : 0;
    const routeAccuracyScore =
      completed.length > 0
        ? Math.max(
            0,
            100 -
              completed.reduce((sum, trip) => {
                const percent = Math.abs(getTripMetrics(trip).differencePercent ?? 0);
                return sum + Math.min(percent, 100);
              }, 0) /
                completed.length
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
        const actualKm = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).actualDistance ?? 0), 0);
        const estimatedKm = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).estimatedDistance ?? 0), 0);
        const litres = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.litres ?? 0), 0);
        const cost = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.cost ?? 0), 0);
        const diff = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).differenceKm ?? 0), 0);
        return {
          ...row,
          completedTrips: completedTrips.length,
          actualKm,
          estimatedKm,
          litres,
          cost,
          kmPerLitre: litres > 0 ? actualKm / litres : null,
          costPerKm: actualKm > 0 ? cost / actualKm : null,
          averageDifferenceKm: completedTrips.length ? diff / completedTrips.length : null,
          performanceLabel: copy.average
        };
      });
      const bestKmPerLitre = rows.filter((row) => row.kmPerLitre != null).sort((a, b) => (b.kmPerLitre ?? 0) - (a.kmPerLitre ?? 0))[0]?.kmPerLitre ?? null;
      const lowestCostPerKm = rows.filter((row) => row.costPerKm != null).sort((a, b) => (a.costPerKm ?? 0) - (b.costPerKm ?? 0))[0]?.costPerKm ?? null;
      return rows.map((row) => ({ ...row, performanceLabel: getPerformanceLabel(row, bestKmPerLitre, lowestCostPerKm, copy) }));
    };

    const driverRows = buildRows((trip) => trip.driver || copy.unassigned);
    const vehicleRows = buildRows((trip) => trip.vehicle_reg || trip.vehicle_type || copy.unassigned);
    const routeRows: RoutePerformanceRow[] = buildRows((trip) => getShortRoutePreview(trip, copy) || trip.route || copy.unknownRoute).map((row) => ({
      ...row,
      route: row.name,
      averageActualKm: row.completedTrips ? row.actualKm / row.completedTrips : null,
      averageEstimatedKm: row.completedTrips ? row.estimatedKm / row.completedTrips : null,
      averageFuelCost: row.completedTrips ? row.cost / row.completedTrips : null,
      performanceLabel: row.completedTrips <= 1 ? copy.limitedData : row.performanceLabel
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

    const bestDriverByKmPerLitre = [...driverRows].filter((row) => row.kmPerLitre != null).sort((a, b) => (b.kmPerLitre ?? 0) - (a.kmPerLitre ?? 0))[0] ?? null;
    const lowestCostDriver = [...driverRows].filter((row) => row.costPerKm != null).sort((a, b) => (a.costPerKm ?? 0) - (b.costPerKm ?? 0))[0] ?? null;
    const bestVehicleByKmPerLitre = [...vehicleRows].filter((row) => row.kmPerLitre != null).sort((a, b) => (b.kmPerLitre ?? 0) - (a.kmPerLitre ?? 0))[0] ?? null;
    const lowestCostVehicle = [...vehicleRows].filter((row) => row.costPerKm != null).sort((a, b) => (a.costPerKm ?? 0) - (b.costPerKm ?? 0))[0] ?? null;
    const mostExpensiveTrip = [...tripRows].filter((row) => row.status === "completed" && row.metrics.costPerKm != null).sort((a, b) => (b.metrics.costPerKm ?? 0) - (a.metrics.costPerKm ?? 0))[0] ?? null;
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
                (100 - (baseFilteredTrips.filter((trip) => !hasValidActiveFuel(trip)).length / baseFilteredTrips.length) * 100) * 0.2
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
      current.distance += metrics.actualDistance ?? 0;
      current.litres += metrics.fuel.litres ?? 0;
      current.cost += metrics.fuel.cost ?? 0;
      current.kmL = current.litres > 0 ? current.distance / current.litres : null;
      monthMap.set(month, current);
    });
    const monthlyTrends = Array.from(monthMap.values()).sort((a, b) => a.label.localeCompare(b.label)).slice(-6);
    const dataQualityNotes = [
      baseFilteredTrips.some((trip) => (getTripMetrics(trip).fuel.cost ?? 0) <= 0) ? copy.dataQualityNoFuelCost : "",
      baseFilteredTrips.some((trip) => trip.linkedFuelLogs.length > 0 && getTripMetrics(trip).fuel.linkedCost <= 0) ? copy.dataQualityLinkedNoCost : "",
      baseFilteredTrips.some((trip) => (getTripMetrics(trip).estimatedDistance ?? 0) > 0 && (getTripMetrics(trip).actualDistance ?? 0) <= 0) ? copy.dataQualityEstimateNoActual : "",
      baseFilteredTrips.some((trip) => (getTripMetrics(trip).actualDistance ?? 0) > 0 && !hasValidActiveFuel(trip)) ? copy.dataQualityActualNoFuel : ""
    ].filter(Boolean);

    return {
      totalTrips: baseFilteredTrips.length,
      completedTrips: completed.length,
      inProgressTrips: baseFilteredTrips.length - completed.length,
      completionPercentage,
      fleetPerformanceScore,
      routeAccuracyScore,
      missingDataTrips: baseFilteredTrips.filter((trip) => !isCompletedTrip(trip)).length,
      missingMileage: baseFilteredTrips.filter((trip) => (getTripMetrics(trip).actualDistance ?? 0) <= 0).length,
      missingEstimate: baseFilteredTrips.filter((trip) => (getTripMetrics(trip).estimatedDistance ?? 0) <= 0).length,
      missingFuel: baseFilteredTrips.filter((trip) => !hasValidActiveFuel(trip)).length,
      totalActual,
      totalEstimated,
      totalLitres,
      totalCost,
      averageKmPerLitre,
      averageCostPerKm,
      averageDifference,
      bestDriver: bestDriverByKmPerLitre?.name ?? "-",
      worstDriver: [...driverRows].filter((row) => row.kmPerLitre != null).sort((a, b) => (a.kmPerLitre ?? 0) - (b.kmPerLitre ?? 0))[0]?.name ?? "-",
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
  }, [baseFilteredTrips, copy]);

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
      if (comparisonSort === "lowest_cost_per_km") return (a.metrics.costPerKm ?? Number.POSITIVE_INFINITY) - (b.metrics.costPerKm ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "worst_kml") return (a.metrics.kmPerLitre ?? Number.POSITIVE_INFINITY) - (b.metrics.kmPerLitre ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "highest_fuel_cost") return (b.metrics.fuel.cost ?? 0) - (a.metrics.fuel.cost ?? 0);
      if (comparisonSort === "lowest_fuel_cost") return (a.metrics.fuel.cost ?? Number.POSITIVE_INFINITY) - (b.metrics.fuel.cost ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "most_actual_km") return (b.metrics.actualDistance ?? 0) - (a.metrics.actualDistance ?? 0);
      if (comparisonSort === "least_actual_km") return (a.metrics.actualDistance ?? Number.POSITIVE_INFINITY) - (b.metrics.actualDistance ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "most_completed_trips") return a.status === b.status ? 0 : a.status === "completed" ? -1 : 1;
      if (comparisonSort === "most_accurate") return Math.abs(a.metrics.differenceKm ?? Number.POSITIVE_INFINITY) - Math.abs(b.metrics.differenceKm ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "least_accurate") return Math.abs(b.metrics.differenceKm ?? 0) - Math.abs(a.metrics.differenceKm ?? 0);
      return (b.metrics.kmPerLitre ?? -1) - (a.metrics.kmPerLitre ?? -1);
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
  const selectedTripHealth =
    selectedTrip && selectedTripStatus === "completed"
      ? getTripHealthLabel(getTripMetrics(selectedTrip), {
          averageKmPerLitre: summary.averageKmPerLitre,
          averageCostPerKm: summary.averageCostPerKm,
          completedTrips: summary.completedTrips
        }, copy)
      : null;
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
    setSelectedTripId(trip.id);
    setForm(tripToForm(trip));
    setHasUnsavedChanges(false);
    setSelectedTripTab("overview");
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
    setForm((current) => (current ? { ...current, [field]: value } : current));
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
    setDistanceMessage(null);
    setDistanceDurationText(null);
    setForm((current) => {
      if (!current) return current;
      if (value === "depot") {
        return {
          ...current,
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
          ...current,
          start_location_type: "pickup_only",
          route_start_type: "pickup_only",
          start_location: "",
          custom_start_address: ""
        };
      }
      return {
        ...current,
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

  const handleCalculateRouteDistance = async () => {
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
          origin: routePlan.origin,
          destination: routePlan.destination,
          waypoints: routePlan.waypoints
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

      const distanceKm = Number(result.data.distanceKm);
      const durationMinutes = result.data.durationSeconds ? Math.max(1, Math.round(result.data.durationSeconds / 60)) : null;
      const durationText = result.data.durationSeconds ? formatDuration(result.data.durationSeconds) : null;
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
              route_source: "google_maps_trip_journey"
            }
          : current
      );
      setDistanceMessage(copy.routeDistanceCalculated);
      setDistanceDurationText(durationText);
    } catch (err) {
      console.warn("Route distance calculation warning:", err);
      setDistanceMessage(copy.routeCalculateFailed);
    } finally {
      setCalculatingDistance(false);
    }
  };

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
        start_mileage: toNumber(form.start_mileage),
        end_mileage: toNumber(form.end_mileage),
        manual_actual_km: toNumber(form.manual_actual_km),
        estimated_distance_km: toNumber(form.estimated_distance_km),
        estimated_duration_minutes: toNumber(form.estimated_duration_minutes),
        google_estimated_km: toNumber(form.google_estimated_km),
        google_estimated_minutes: toNumber(form.google_estimated_minutes),
        route_source: form.route_source,
        google_maps_route_url: form.google_maps_route_url,
        booking_estimated_km: toNumber(form.booking_estimated_km),
        booking_estimated_minutes: toNumber(form.booking_estimated_minutes),
        booking_google_maps_route_url: form.booking_google_maps_route_url,
        estimated_distance_source: form.route_source || selectedTrip?.estimated_distance_source || null,
        manual_estimated_distance_km: toNumber(form.manual_estimated_distance_km),
        manual_litres_used: toNumber(form.manual_litres_used),
        manual_fuel_cost: toNumber(form.manual_fuel_cost),
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

  return (
    <div className="-m-4 space-y-5 bg-gradient-to-br from-brand-50/55 via-slate-50 to-white p-4 sm:-m-5 sm:p-5">
      <section className="rounded-xl border border-brand-100/70 bg-white/95 p-4 shadow-sm shadow-brand-950/5 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{copy.tripJourney}</p>
            <h2 className="mt-1 text-2xl font-bold tracking-normal text-slate-950">{copy.tripPerformance}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              {copy.description}
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="btn-secondary gap-2">
            <RefreshCw className="h-4 w-4" />
            {copy.refresh}
          </button>
        </div>
        {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div> : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-brand-100 bg-white p-5 shadow-sm shadow-brand-950/5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-brand-50 p-2 text-brand-700"><BarChart3 className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-semibold text-slate-500">{copy.operationsOverview}</p>
                <p className="mt-1 text-3xl font-bold text-slate-950">{summary.totalTrips}</p>
              </div>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{copy.trips}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.tripsCompleted}</p><p className="text-lg font-bold">{summary.completedTrips}</p></div>
            <div className={metricTileClass(summary.inProgressTrips ? "amber" : "slate")}><p className="text-xs font-semibold opacity-80">{copy.tripsInProgress}</p><p className="text-lg font-bold">{summary.inProgressTrips}</p></div>
            <div className={metricTileClass(summary.missingMileage ? "amber" : "slate")}><p className="text-xs font-semibold opacity-80">{copy.missingMileage}</p><p className="text-lg font-bold">{summary.missingMileage}</p></div>
            <div className={metricTileClass(summary.missingEstimate ? "amber" : "slate")}><p className="text-xs font-semibold opacity-80">{copy.missingEstimate}</p><p className="text-lg font-bold">{summary.missingEstimate}</p></div>
            <div className={metricTileClass(summary.missingFuel ? "amber" : "slate")}><p className="text-xs font-semibold opacity-80">{copy.missingFuel}</p><p className="text-lg font-bold">{summary.missingFuel}</p></div>
            <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.overallCompletion}</p><p className="text-lg font-bold">{summary.completionPercentage}%</p></div>
          </div>
        </div>
        <div className={`rounded-xl border p-5 shadow-sm shadow-slate-950/5 ${getScoreClass(summary.fleetPerformanceScore)}`}>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-white/70 p-2"><Gauge className="h-5 w-5" /></div>
            <p className="text-sm font-semibold">{copy.fleetPerformance}</p>
          </div>
          <p className="mt-4 text-5xl font-bold tracking-normal">{summary.fleetPerformanceScore}%</p>
          <p className="mt-2 text-sm font-semibold opacity-80">{copy.fleetPerformanceHelper}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-white/70 px-3 py-2"><p className="font-semibold opacity-70">{copy.overallCompletion}</p><p className="text-lg font-bold">{summary.completionPercentage}%</p></div>
            <div className="rounded-lg bg-white/70 px-3 py-2"><p className="font-semibold opacity-70">{copy.routeAccuracy}</p><p className="text-lg font-bold">{formatNumber(summary.routeAccuracyScore)}%</p></div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><MapPinned className="h-5 w-5" /></div>
            <p className="text-sm font-semibold text-slate-500">{copy.distanceFuel}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.actualKm}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.totalActual)}</p></div>
            <div className={metricTileClass("slate")}><p className="text-xs font-semibold opacity-80">{copy.estimatedKm}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.totalEstimated)}</p></div>
            <div className={metricTileClass("amber")}><p className="text-xs font-semibold opacity-80">{copy.difference}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.averageDifference)} km</p></div>
            <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.litres}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.totalLitres, 2)}</p></div>
            <div className={`col-span-2 ${metricTileClass("purple")}`}><p className="text-xs font-semibold opacity-80">{copy.fuelCost}</p><p className="text-xl font-bold text-slate-950">{formatCurrency(summary.totalCost)}</p></div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><Gauge className="h-5 w-5" /></div>
            <p className="text-sm font-semibold text-slate-500">{copy.efficiency}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.avgKmL}</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.averageKmPerLitre, 2)}</p></div>
            <div className={metricTileClass("amber")}><p className="text-xs font-semibold opacity-80">{copy.avgCostKm}</p><p className="text-xl font-bold text-slate-950">{formatCurrency(summary.averageCostPerKm)}</p></div>
            <div className={`col-span-2 ${metricTileClass("green")}`}><p className="text-xs font-semibold opacity-80">{copy.bestDriver}</p><p className="truncate font-bold text-slate-950">{summary.bestDriver}</p></div>
            <div className={`col-span-2 ${metricTileClass("amber")}`}><p className="text-xs font-semibold opacity-80">{copy.worstDriver}</p><p className="truncate font-bold text-slate-950">{summary.worstDriver}</p></div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm shadow-slate-950/5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">{copy.filters}</h3>
            <p className="text-xs text-slate-500">{copy.filtersDescription}</p>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {[
            ["today", copy.today],
            ["yesterday", copy.yesterday],
            ["week", copy.thisWeek],
            ["month", copy.thisMonth],
            ["missing_mileage", copy.missingMileageTitle],
            ["missing_fuel", copy.missingFuelTitle],
            ["completed", copy.completed]
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyQuickFilter(key as Parameters<typeof applyQuickFilter>[0])}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
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
            <option value="all">{copy.allData}</option>
            <option value="missing">{copy.missingDataOnly}</option>
            <option value="completed">{copy.completedOnly}</option>
          </select>
          <select value={filters.fuelLink} onChange={(event) => setFilters((current) => ({ ...current, fuelLink: event.target.value as TripFilter["fuelLink"] }))} className="form-input bg-white">
            <option value="all">{copy.allFuelLinks}</option>
            <option value="linked">{copy.fuelLogsLinked}</option>
            <option value="not_linked">{copy.fuelLogsNotLinked}</option>
          </select>
          <button type="button" onClick={() => { setFilters(emptyFilters); setAttentionFilter("all"); }} className="btn-secondary min-h-11 whitespace-nowrap px-4 py-2 text-sm">
            {copy.resetFilters}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-amber-100 bg-white p-4 shadow-sm shadow-amber-950/5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="section-title">{copy.needsAttention}</h3>
            <p className="section-subtitle">{copy.needsAttentionDescription}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[640px]">
            <button type="button" onClick={() => setAttentionFilter("missing_mileage")} className={`rounded-lg border px-4 py-3 text-left transition ${attentionFilter === "missing_mileage" ? "border-brand-300 bg-brand-50 ring-2 ring-brand-100" : summary.missingMileage ? "border-amber-200 bg-amber-50 hover:border-amber-300" : "border-emerald-100 bg-emerald-50/60 hover:border-emerald-200"}`}>
              <p className={`text-xs font-semibold ${summary.missingMileage ? "text-amber-700" : "text-emerald-700"}`}>{copy.missingMileage}</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{summary.missingMileage} {summary.missingMileage === 1 ? copy.trip : copy.trips}</p>
              <p className="mt-1 text-xs text-slate-500">{copy.actualKmNeeded}</p>
              <span className="mt-3 inline-flex rounded-md bg-white/75 px-2.5 py-1 text-xs font-bold text-slate-700">{copy.viewTrips}</span>
            </button>
            <button type="button" onClick={() => setAttentionFilter("missing_estimate")} className={`rounded-lg border px-4 py-3 text-left transition ${attentionFilter === "missing_estimate" ? "border-brand-300 bg-brand-50 ring-2 ring-brand-100" : summary.missingEstimate ? "border-amber-200 bg-amber-50 hover:border-amber-300" : "border-emerald-100 bg-emerald-50/60 hover:border-emerald-200"}`}>
              <p className={`text-xs font-semibold ${summary.missingEstimate ? "text-amber-700" : "text-emerald-700"}`}>{copy.missingEstimate}</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{summary.missingEstimate} {summary.missingEstimate === 1 ? copy.trip : copy.trips}</p>
              <p className="mt-1 text-xs text-slate-500">{copy.comparePlannedActual}</p>
              <span className="mt-3 inline-flex rounded-md bg-white/75 px-2.5 py-1 text-xs font-bold text-slate-700">{copy.viewTrips}</span>
            </button>
            <button type="button" onClick={() => setAttentionFilter("missing_fuel")} className={`rounded-lg border px-4 py-3 text-left transition ${attentionFilter === "missing_fuel" ? "border-brand-300 bg-brand-50 ring-2 ring-brand-100" : summary.missingFuel ? "border-amber-200 bg-amber-50 hover:border-amber-300" : "border-emerald-100 bg-emerald-50/60 hover:border-emerald-200"}`}>
              <p className={`text-xs font-semibold ${summary.missingFuel ? "text-amber-700" : "text-emerald-700"}`}>{copy.missingFuel}</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{summary.missingFuel} {summary.missingFuel === 1 ? copy.trip : copy.trips}</p>
              <p className="mt-1 text-xs text-slate-500">{copy.linkFuelLogsOrManual}</p>
              <span className="mt-3 inline-flex rounded-md bg-white/75 px-2.5 py-1 text-xs font-bold text-slate-700">{copy.viewTrips}</span>
            </button>
          </div>
        </div>
        {attentionFilter !== "all" ? (
          <button type="button" onClick={() => setAttentionFilter("all")} className="btn-secondary mt-3 min-h-9 px-3 py-1.5 text-xs">
            {copy.showAllTrips}
          </button>
        ) : null}
      </section>

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
                <th className="px-3 py-3 text-right">{copy.avgKmL}</th>
                <th className="px-3 py-3 text-right">{copy.avgCostKm}</th>
                <th className="px-3 py-3 text-right">{copy.distanceTravelled}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {topDriverRows.map((row, index) => (
                <tr key={row.name} className="transition hover:bg-brand-50/45">
                  <td className="px-3 py-3 font-bold text-slate-950">#{index + 1}</td>
                  <td className="px-3 py-3 font-bold text-slate-950">{row.name}</td>
                  <td className="px-3 py-3">{row.vehicle}</td>
                  <td className="px-3 py-3 text-right font-semibold">{row.completedTrips}</td>
                  <td className="px-3 py-3 text-right font-semibold">{formatNumber(row.kmPerLitre, 2)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.costPerKm)}</td>
                  <td className="px-3 py-3 text-right">{formatNumber(row.actualKm)} km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="trip-records" className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="section-title">{copy.tripRecords}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{filteredTrips.length} {filteredTrips.length === 1 ? copy.trip : copy.trips}</span>
            </div>
            <p className="section-subtitle">{copy.tripRecordsDescription}</p>
          </div>
          <p className="text-xs font-semibold text-slate-500">{copy.newestTripsFirst}</p>
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
              const completionPercent = getTripCompletionPercent(trip);
              const healthLabel = derivedStatus === "completed"
                  ? getTripHealthLabel(metrics, {
                    averageKmPerLitre: summary.averageKmPerLitre,
                    averageCostPerKm: summary.averageCostPerKm,
                    completedTrips: summary.completedTrips
                  }, copy)
                : statusLabel(derivedStatus, copy);
              return (
                <article id={`trip-${trip.id}`} key={trip.id} className={`scroll-mt-6 rounded-xl border-l-4 px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${getStatusAccent(derivedStatus)} ${selectedTripId === trip.id ? "border-brand-300 ring-2 ring-brand-200" : "border-slate-200 hover:border-brand-200"}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedTripId === trip.id ? <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-bold text-white">{copy.selectedTrip}</span> : null}
                        <p className="text-sm font-bold text-slate-950">{formatDate(trip.trip_date)}</p>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(derivedStatus)}`}>{statusLabel(derivedStatus, copy)}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(healthLabel, copy)}`}>{healthLabel}</span>
                      </div>
                      <p className="mt-2 truncate text-lg font-bold leading-6 text-slate-950" title={getRoutePreview(trip)}>{getShortRoutePreview(trip, copy)}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-600">
                        <span>{copy.driver}: {trip.driver || "-"}</span>
                        <span>{copy.vehicle}: {trip.vehicle_reg || trip.vehicle_type || "-"}</span>
                        <span>{copy.fuelLogs}: {trip.linkedFuelLogs.length ? `${trip.linkedFuelLogs.length} ${copy.linked}` : copy.noneLinked}</span>
                      </div>
                      {trip.fuel_source === "manual" && trip.linkedFuelLogs.length > 0 ? (
                        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{copy.noFuelManualWarning}</p>
                      ) : null}
                    </div>
                    <div className="grid gap-2 text-xs sm:grid-cols-4 lg:w-[760px]">
                      <div className={metricTileClass(metrics.estimatedDistance == null ? "amber" : "purple")}><p className="font-semibold opacity-80">{copy.estimatedKmShort}</p><p className="font-bold text-slate-950">{metrics.estimatedDistance == null ? copy.missing : `${formatNumber(metrics.estimatedDistance)} km`}</p><p className="text-[11px] text-slate-500">{getEstimateSourceLabel(trip, copy)}</p></div>
                      <div className={metricTileClass(metrics.actualDistance == null ? "amber" : "green")}><p className="font-semibold opacity-80">{copy.actualKm}</p><p className="font-bold text-slate-950">{metrics.actualDistance == null ? copy.missing : `${formatNumber(metrics.actualDistance)} km`}</p></div>
                      <div className={metricTileClass(metrics.differenceKm != null && metrics.differenceKm > 0 ? "amber" : "slate")}><p className="font-semibold opacity-80">{copy.difference}</p><p className="font-bold text-slate-950">{metrics.differenceKm == null ? "-" : `${formatNumber(metrics.differenceKm)} km`}</p></div>
                      <div className={metricTileClass(metrics.fuel.litres != null && metrics.fuel.litres > 0 ? "green" : "amber")}><p className="font-semibold opacity-80">{copy.fuel}</p><p className="font-bold text-slate-950">{metrics.fuel.litres != null && metrics.fuel.litres > 0 ? `${formatNumber(metrics.fuel.litres, 2)} L` : copy.noFuel}</p></div>
                      <div className={metricTileClass(metrics.fuel.cost != null && metrics.fuel.cost > 0 ? "slate" : "amber")}><p className="font-semibold opacity-80">{copy.cost}</p><p className="font-bold text-slate-950">{metrics.fuel.cost != null && metrics.fuel.cost > 0 ? formatCurrency(metrics.fuel.cost) : copy.noFuelCost}</p></div>
                      <div className={metricTileClass("green")}><p className="font-semibold opacity-80">{copy.kmL}</p><p className="font-bold text-slate-950">{formatNumber(metrics.kmPerLitre, 2)}</p></div>
                      <div className={metricTileClass("slate")}><p className="font-semibold opacity-80">{copy.costKm}</p><p className="font-bold text-slate-950">{formatCurrency(metrics.costPerKm)}</p></div>
                      <div className={metricTileClass(completionPercent === 100 ? "green" : "amber")}><p className="font-semibold opacity-80">{copy.completion}</p><p className="font-bold text-slate-950">{completionPercent}%</p></div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                      {derivedStatus !== "completed" ? (
                        <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                          {copy.needsAttentionAction}: {statusActionText(derivedStatus, copy)}
                        </span>
                      ) : null}
                      <button type="button" onClick={() => openTrip(trip)} className="btn-secondary min-h-8 px-3 py-1 text-xs">{copy.view}</button>
                      <button type="button" onClick={() => openTrip(trip)} className="btn-secondary min-h-8 px-3 py-1 text-xs">{copy.edit}</button>
                      {trip.booking_id || trip.booking_diary_id ? (
                        <a href={`/booking-diary?bookingId=${encodeURIComponent(String(trip.booking_id ?? trip.booking_diary_id))}`} className="btn-secondary min-h-8 px-3 py-1 text-xs">{copy.openBooking}</a>
                      ) : null}
                      <button type="button" onClick={() => { openTrip(trip); setSelectedTripTab("fuel"); }} className="btn-secondary min-h-8 px-3 py-1 text-xs">{copy.openFuelLogs}</button>
                      <button type="button" onClick={() => requestDeleteTrip(trip)} className="min-h-8 rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-50">{copy.delete}</button>
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

      {form && selectedTrip ? (
        <section className="overflow-hidden rounded-xl border border-brand-100 bg-white shadow-sm shadow-brand-950/5">
          <div className="border-b border-brand-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50/70 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-bold text-white">{copy.selectedTrip}</span>
                  <h3 className="text-lg font-bold text-slate-950">{copy.selectedTripOverview}</h3>
                  {selectedTripStatus ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(selectedTripStatus)}`}>{statusLabel(selectedTripStatus, copy)}</span> : null}
                  {selectedTripHealth ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(selectedTripHealth, copy)}`}>{selectedTripHealth}</span> : null}
                </div>
                <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-slate-700" title={getRoutePreview(selectedTrip)}>{getShortRoutePreview(selectedTrip, copy)}</p>
              </div>
              <div className="flex min-w-[240px] flex-wrap gap-2 text-sm">
                <div className={metricTileClass("purple")}><p className="text-[11px] font-semibold opacity-80">{copy.driver}</p><p className="font-bold text-slate-950">{selectedTrip.driver || "-"}</p></div>
                <div className={metricTileClass("slate")}><p className="text-[11px] font-semibold opacity-80">{copy.vehicle}</p><p className="font-bold text-slate-950">{selectedTrip.vehicle_reg || "-"}</p></div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.distance}</p><p className="font-bold text-slate-950">{copy.estimatedKmShort} {formatNumber(selectedFormMetrics?.estimatedDistance)} km / {copy.actualKm} {formatNumber(selectedFormMetrics?.actualDistance)} km</p><p className="text-xs font-semibold text-slate-500">{selectedEstimateSource}</p></div>
              <div className={metricTileClass(selectedFormMetrics?.fuelLitres && selectedFormMetrics?.fuelCost ? "green" : "amber")}><p className="text-xs font-semibold opacity-80">{copy.fuel}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.fuelLitres, 2)} L / {formatCurrency(selectedFormMetrics?.fuelCost)}</p></div>
              <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.efficiency}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.kmPerLitre, 2)} {copy.kmL} / {formatCurrency(selectedFormMetrics?.costPerKm)}</p></div>
              <div className={metricTileClass(selectedTrip.linkedFuelLogs.length ? "green" : "slate")}><p className="text-xs font-semibold opacity-80">{copy.fuelLogs}</p><p className="font-bold text-slate-950">{selectedTrip.linkedFuelLogs.length ? `${selectedTrip.linkedFuelLogs.length} ${copy.linked}` : copy.noneLinked}</p></div>
            </div>
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-brand-100 bg-white/85 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">{copy.nextAction}</p>
                <p className="text-sm font-bold text-slate-950">{statusActionText(selectedTripStatus ?? "created", copy)}</p>
                <p className="text-xs text-slate-500">{getNextActionHelper(selectedTripStatus ?? "created", copy)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => handlePrimaryTripAction(selectedTripStatus ?? "created")} className="btn-primary min-h-9 px-3 py-1.5 text-sm">
                  {statusActionText(selectedTripStatus ?? "created", copy)}
                </button>
                <button type="button" onClick={() => setSelectedTripTab("fuel")} className="btn-secondary min-h-9 px-3 py-1.5 text-sm">{copy.manageFuelLogs}</button>
                <button type="button" onClick={() => requestDeleteTrip(selectedTrip)} className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50">{copy.deleteTrip}</button>
                <button type="button" onClick={() => { setSelectedTripId(null); setHasUnsavedChanges(false); }} className="btn-secondary min-h-9 px-3 py-1.5 text-sm">{copy.backToTripList}</button>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-slate-50/90 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {[
                ["overview", copy.overview],
                ["journey", copy.journeyDetails],
                ["fuel", copy.fuelLogs],
                ["notes", copy.notes]
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedTripTab(key as SelectedTripTab)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${selectedTripTab === key ? "bg-white text-brand-700 shadow-sm ring-1 ring-brand-100" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4">
            {selectedTripTab === "overview" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-brand-100 bg-brand-50/45 p-4">
                  <h4 className="font-bold text-slate-950">{copy.route}</h4>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-700" title={getRoutePreview(selectedTrip)}>{getShortRoutePreview(selectedTrip, copy)}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div><p className="text-xs text-slate-500">{copy.date}</p><p className="font-bold text-slate-950">{formatDate(selectedTrip.trip_date)}</p></div>
                    <div><p className="text-xs text-slate-500">{copy.pickupTime}</p><p className="font-bold text-slate-950">{selectedTrip.pickup_time || "-"}</p></div>
                    <div><p className="text-xs text-slate-500">{copy.bookingRef}</p><p className="font-bold text-slate-950">{selectedTrip.booking_reference || "-"}</p></div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="font-bold text-slate-950">{copy.journeyTimeline}</h4>
                  <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-stretch">
                    {compactRouteParts(getShortRoutePreview(selectedTrip, copy).split(" -> ")).map((stop, index, routeStops) => (
                      <div key={`${stop}-${index}`} className="flex flex-1 items-center gap-2">
                        <div className="min-h-[72px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <p className="text-[11px] font-bold uppercase text-slate-500">
                            {index === 0 ? copy.pickup : index === routeStops.length - 1 && selectedTrip.return_to_depot ? copy.return : index === routeStops.length - 1 ? copy.dropoff : copy.additionalStops}
                          </p>
                          <p className="mt-1 line-clamp-2 text-sm font-bold text-slate-950">{stop}</p>
                        </div>
                        {index < routeStops.length - 1 ? <span className="hidden text-slate-400 md:inline">→</span> : null}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.estimatedKm}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.estimatedDistance)} km</p></div>
                    <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.actualKm}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.actualDistance)} km</p></div>
                    <div className={metricTileClass("amber")}><p className="text-xs font-semibold opacity-80">{copy.difference}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.differenceKm)} km</p></div>
                    <div className={metricTileClass("slate")}><p className="text-xs font-semibold opacity-80">{copy.fuelUsedTrend}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.fuelLitres, 2)} L</p></div>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedTripTab === "journey" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-3">
                  <section className="rounded-lg border border-brand-100 bg-white p-3 shadow-sm">
                    <h4 className="rounded-md bg-brand-50 px-3 py-2 font-bold text-slate-950">{copy.bookingInfo}</h4>
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                      <div className="form-field"><label className="form-label">{copy.bookingRef}</label><input value={form.booking_reference} onChange={(event) => updateForm("booking_reference", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">{copy.date}</label><input type="date" value={form.trip_date} onChange={(event) => updateForm("trip_date", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">{copy.pickupTime}</label><input value={form.pickup_time} onChange={(event) => updateForm("pickup_time", event.target.value)} className="form-input bg-white" /></div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <h4 className="rounded-md bg-slate-50 px-3 py-2 font-bold text-slate-950">{copy.driverVehicle}</h4>
                    <p className="mt-1 text-xs text-slate-500">{copy.driverVehicleHelper}</p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="form-field">
                        <label className="form-label">{copy.driver}</label>
                        <input list="trip-driver-options" value={form.driver} onChange={(event) => handleDriverChange(event.target.value)} placeholder={copy.selectOrTypeDriver} className="form-input bg-white" />
                        <datalist id="trip-driver-options">
                          {driverDatalistOptions.map((driver) => <option key={driver} value={driver} />)}
                          <option value={copy.manualDriverEntry} />
                        </datalist>
                      </div>
                      <div className="form-field">
                        <label className="form-label">{copy.vehicle}</label>
                        <input list="trip-vehicle-options" value={form.vehicle_reg} onChange={(event) => handleVehicleChange(event.target.value)} placeholder={copy.selectOrTypeVehicle} className="form-input bg-white" />
                        <datalist id="trip-vehicle-options">
                          {vehicleDatalistOptions.map((vehicle) => <option key={vehicle} value={vehicle} />)}
                          <option value={copy.manualVehicleEntry} />
                        </datalist>
                      </div>
                    </div>
                    {driverVehicleMessage ? <p className="mt-2 text-xs font-semibold text-slate-500">{driverVehicleMessage}</p> : null}
                  </section>

                  <section className="rounded-lg border border-emerald-100 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="rounded-md bg-emerald-50 px-3 py-2 font-bold text-slate-950">{copy.routeGoogleMaps}</h4>
                        <p className="mt-1 text-xs text-slate-500">{copy.routeGoogleMapsHelper}</p>
                      </div>
                      <button type="button" onClick={() => void handleCalculateRouteDistance()} disabled={calculatingDistance} className="btn-secondary min-h-9 px-3 py-1.5 text-sm">
                        {calculatingDistance ? copy.calculating : copy.calculateRouteDistance}
                      </button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <p className="form-label">{copy.startLocationType}</p>
                        <div className="grid gap-2 lg:grid-cols-3">
                          <label className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${form.start_location_type === "depot" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700"}`}>
                            <input type="radio" name="trip-start-location-type" checked={form.start_location_type === "depot"} onChange={() => handleStartLocationTypeChange("depot")} className="h-4 w-4" />
                            {copy.startsFromDepot}
                          </label>
                          <label className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${form.start_location_type === "custom" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700"}`}>
                            <input type="radio" name="trip-start-location-type" checked={form.start_location_type === "custom"} onChange={() => handleStartLocationTypeChange("custom")} className="h-4 w-4" />
                            {copy.startsFromCustom}
                          </label>
                          <label className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${form.start_location_type === "pickup_only" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700"}`}>
                            <input type="radio" name="trip-start-location-type" checked={form.start_location_type === "pickup_only"} onChange={() => handleStartLocationTypeChange("pickup_only")} className="h-4 w-4" />
                            {copy.startsPickupDropoffOnly}
                          </label>
                        </div>
                      </div>
                      {form.start_location_type !== "pickup_only" ? (
                        <div className="form-field sm:col-span-2">
                          <label className="form-label">{form.start_location_type === "depot" ? copy.depotAddress : copy.startLocation}</label>
                          <input value={form.start_location_type === "depot" ? form.depot_address || DEPOT_ADDRESS : form.start_location} onChange={(event) => updateForm(form.start_location_type === "depot" ? "depot_address" : "start_location", event.target.value)} disabled={form.start_location_type === "depot"} placeholder={form.start_location_type === "custom" ? copy.enterStartLocation : copy.depotAddress} className="form-input bg-white disabled:bg-slate-100 disabled:text-slate-500" />
                        </div>
                      ) : null}
                      <div className="form-field"><label className="form-label">{copy.pickupLocation}</label><input value={form.pickup_location} onChange={(event) => updateForm("pickup_location", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">{copy.dropoffLocation}</label><input value={form.dropoff_location} onChange={(event) => updateForm("dropoff_location", event.target.value)} className="form-input bg-white" /></div>
                      <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.return_to_depot} onChange={(event) => updateForm("return_to_depot", event.target.checked)} className="h-4 w-4" />{copy.returnToDepot}</label>
                      <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm sm:col-span-2">
                        <p className="text-xs font-semibold text-slate-500">{copy.routePreview}</p>
                        <p className="font-bold text-slate-950">{getCurrentRoutePreview() || "-"}</p>
                      </div>
                      <div className="grid gap-2 rounded-lg bg-slate-50 p-2 text-sm sm:col-span-2 md:grid-cols-3">
                        <div className="rounded-md bg-white px-3 py-2">
                          <p className="text-xs font-semibold text-slate-500">{copy.bookingEstimate}</p>
                          <p className="font-bold text-slate-950">{bookingEstimateKm != null && bookingEstimateKm > 0 ? `${formatNumber(bookingEstimateKm, 2)} km` : copy.notCalculated}</p>
                          <p className="text-xs text-slate-500">{copy.bookingEstimateHelper}{bookingEstimateMinutes != null && bookingEstimateMinutes > 0 ? ` / ${formatDuration(bookingEstimateMinutes * 60)}` : ""}</p>
                        </div>
                        <div className="rounded-md bg-white px-3 py-2">
                          <p className="text-xs font-semibold text-slate-500">{copy.tripJourneyEstimate}</p>
                          <p className="font-bold text-slate-950">{tripGoogleEstimateKm != null && tripGoogleEstimateKm > 0 ? `${formatNumber(tripGoogleEstimateKm, 2)} km` : copy.notCalculated}</p>
                          <p className="text-xs text-slate-500">{copy.tripJourneyEstimateHelper}{tripGoogleEstimateMinutes != null && tripGoogleEstimateMinutes > 0 ? ` / ${formatDuration(tripGoogleEstimateMinutes * 60)}` : distanceDurationText ? ` / ${distanceDurationText}` : ""}</p>
                        </div>
                        <div className="rounded-md bg-white px-3 py-2">
                          <p className="text-xs font-semibold text-slate-500">{copy.routeSource}</p>
                          <p className="font-bold text-slate-950">{selectedEstimateSource}</p>
                          <p className="text-xs text-slate-500">{copy.displayEstimatePriority}</p>
                        </div>
                      </div>
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm sm:col-span-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-semibold text-slate-500">{copy.routeSummary}</p>
                            <p className="font-bold text-slate-950">{copy.bookingRouteLabel}: {copy.pickupDropoffOnly} = {bookingEstimateKm != null && bookingEstimateKm > 0 ? `${formatNumber(bookingEstimateKm, 2)} km` : copy.notCalculated}{bookingEstimateMinutes != null && bookingEstimateMinutes > 0 ? ` / ${formatDuration(bookingEstimateMinutes * 60)}` : ""}</p>
                            <p className="mt-1 font-bold text-slate-950">{copy.tripRouteLabel}: {getCurrentRoutePreview() || "-"} = {tripGoogleEstimateKm != null && tripGoogleEstimateKm > 0 ? `${formatNumber(tripGoogleEstimateKm, 2)} km` : copy.notCalculated}{tripGoogleEstimateMinutes != null && tripGoogleEstimateMinutes > 0 ? ` / ${formatDuration(tripGoogleEstimateMinutes * 60)}` : ""}</p>
                          </div>
                          {currentGoogleMapsUrl ? (
                            <a href={currentGoogleMapsUrl} target="_blank" rel="noreferrer" className="btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-sm">
                              <MapPinned className="h-4 w-4" />
                              {copy.openInGoogleMaps}
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <div className="form-field">
                        <label className="form-label">{copy.manualEstimatedOverride}</label>
                        <input ref={manualEstimatedKmRef} type="number" min="0" step="0.01" value={form.manual_estimated_distance_km} onChange={(event) => updateForm("manual_estimated_distance_km", event.target.value)} className="form-input bg-white" />
                        <p className="text-xs text-slate-500">{copy.manualEstimateHelper}</p>
                      </div>
                    </div>
                    {distanceMessage ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">{distanceMessage}</p> : null}
                  </section>

                  <section className="rounded-lg border border-amber-100 bg-white p-3 shadow-sm">
                    <h4 className="rounded-md bg-amber-50 px-3 py-2 font-bold text-slate-950">{copy.actualDistance}</h4>
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                      <div className="form-field"><label className="form-label">{copy.manualActualKm}</label><input ref={manualActualKmRef} type="number" min="0" step="0.01" value={form.manual_actual_km} onChange={(event) => updateForm("manual_actual_km", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">{copy.startMileage}</label><input type="number" min="0" value={form.start_mileage} onChange={(event) => updateForm("start_mileage", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">{copy.endMileage}</label><input type="number" min="0" value={form.end_mileage} onChange={(event) => updateForm("end_mileage", event.target.value)} className="form-input bg-white" /></div>
                    </div>
                  </section>
                </div>
                <div className="self-start rounded-lg border border-brand-100 bg-brand-50/60 p-3 shadow-sm xl:sticky xl:top-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">{selectedFormMetrics?.actualSource}</p>
                      <p className="text-xl font-bold text-slate-950">{formatNumber(selectedFormMetrics?.actualDistance)} km</p>
                    </div>
                    {selectedTripStatus ? <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusClass(selectedTripStatus)}`}>{statusLabel(selectedTripStatus, copy)}</span> : null}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="rounded-lg bg-white px-3 py-2"><p className="text-xs text-slate-500">{copy.estimatedKm}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.estimatedDistance)} km</p><p className="text-xs font-semibold text-slate-500">{selectedEstimateSource}</p></div>
                    <div className="rounded-lg bg-white px-3 py-2"><p className="text-xs text-slate-500">{copy.difference}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.differenceKm)} km</p></div>
                    <div className="rounded-lg bg-white px-3 py-2"><p className="text-xs text-slate-500">{copy.fuelStatus}</p><p className="font-bold text-slate-950">{selectedFormMetrics?.fuelLitres && selectedFormMetrics?.fuelCost ? `${formatNumber(selectedFormMetrics.fuelLitres, 2)} L / ${formatCurrency(selectedFormMetrics.fuelCost)}` : copy.noFuel}</p></div>
                  </div>
                  <button type="button" onClick={() => void handleSaveTrip()} disabled={saving} className="btn-primary mt-3 w-full gap-2"><Save className="h-4 w-4" />{saving ? copy.saving : copy.saveTrip}</button>
                  <p className={`mt-2 text-xs font-semibold ${hasUnsavedChanges ? "text-amber-700" : "text-emerald-700"}`}>{hasUnsavedChanges ? copy.unsavedChanges : notice === copy.tripSavedSuccessfully ? copy.tripSavedSuccessfully : copy.noUnsavedChanges}</p>
                  <p className="mt-1 text-xs text-slate-500">{copy.editDoesNotChangeBooking}</p>
                </div>
              </div>
            ) : null}

            {selectedTripTab === "fuel" ? (
              <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="font-bold text-slate-950">{copy.fuelSummary}</h4>
                  <div className="mt-3 grid gap-3">
                    <div className="form-field"><label className="form-label">{copy.fuelSource}</label><select value={form.fuel_source} onChange={(event) => updateForm("fuel_source", event.target.value as TripFuelSource)} className="form-input bg-white"><option value="linked">{copy.useLinkedFuelLogs}</option><option value="manual">{copy.useManualFuelEntry}</option></select></div>
                    {form.fuel_source === "manual" ? <><div className="form-field"><label className="form-label">{copy.manualLitresUsed}</label><input type="number" min="0" step="0.01" value={form.manual_litres_used} onChange={(event) => updateForm("manual_litres_used", event.target.value)} className="form-input bg-white" /></div><div className="form-field"><label className="form-label">{copy.manualFuelCost}</label><input type="number" min="0" step="0.01" value={form.manual_fuel_cost} onChange={(event) => updateForm("manual_fuel_cost", event.target.value)} className="form-input bg-white" /></div></> : null}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{copy.litres}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.fuelLitres, 2)}</p></div>
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{copy.cost}</p><p className="font-bold text-slate-950">{formatCurrency(selectedFormMetrics?.fuelCost)}</p></div>
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{copy.kmL}</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.kmPerLitre, 2)}</p></div>
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{copy.costKm}</p><p className="font-bold text-slate-950">{formatCurrency(selectedFormMetrics?.costPerKm)}</p></div>
                    </div>
                    <button type="button" onClick={() => void handleSaveTrip()} disabled={saving} className="btn-primary w-full gap-2"><Save className="h-4 w-4" />{saving ? copy.saving : copy.saveTrip}</button>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="font-bold text-slate-950">{copy.linkedFuelLogs}</h4>
                    <div className="mt-3 space-y-2">
                      {selectedTrip.linkedFuelLogs.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">{copy.noFuelLogsLinkedYet}</p> : null}
                      {selectedTrip.linkedFuelLogs.map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{formatDate(log.date)} | {log.vehicle_reg} | {log.driver}</p><p className="text-xs text-slate-500">{formatNumber(Number(log.litres || 0), 2)} L | {formatCurrency(Number(log.total_cost || 0))} | {log.station || log.location}</p></div><button type="button" onClick={() => void handleUnlinkFuelLog(String(log.id))} className="btn-secondary min-h-8 gap-2 px-3 py-1 text-xs"><Unlink className="h-3.5 w-3.5" /> {copy.unlink}</button></div>)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-slate-950">{copy.addSearchFuelLogs}</h4><button type="button" onClick={() => setManualFuelExpanded((current) => !current)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">{manualFuelExpanded ? copy.hide : copy.addFuelLog}</button></div>
                    {manualFuelExpanded ? <div className="mt-4 space-y-4"><div><p className="text-sm font-semibold text-slate-800">{copy.suggestedLogs}</p><div className="mt-2 space-y-2">{suggestedFuelLogs.length === 0 ? <p className="text-sm text-slate-500">{copy.noSuggestedFuelLogs}</p> : null}{suggestedFuelLogs.slice(0, 5).map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{formatDate(log.date)} | {log.vehicle_reg} | {log.driver}</p><p className="text-xs text-slate-500">{formatNumber(Number(log.litres || 0), 2)} L | {formatCurrency(Number(log.total_cost || 0))}</p></div><button type="button" onClick={() => void handleLinkFuelLog(String(log.id))} className="btn-primary min-h-8 gap-2 px-3 py-1 text-xs"><Link2 className="h-3.5 w-3.5" /> {copy.link}</button></div>)}</div></div><div className="grid gap-2 sm:grid-cols-2"><input value={manualFuelSearch} onChange={(event) => setManualFuelSearch(event.target.value)} placeholder={copy.searchFuelPlaceholder} className="form-input bg-white" /><input type="date" value={manualFuelDate} onChange={(event) => setManualFuelDate(event.target.value)} className="form-input bg-white" /></div><div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">{manualFuelLogOptions.length === 0 ? <p className="text-sm text-slate-500">{copy.noOtherFuelLogs}</p> : null}{manualFuelLogOptions.map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{formatDate(log.date)} | {log.vehicle_reg} | {log.driver}</p><p className="text-xs text-slate-500">{formatNumber(Number(log.litres || 0), 2)} L | {formatCurrency(Number(log.total_cost || 0))} | {log.station || log.location}</p></div><button type="button" onClick={() => void handleLinkFuelLog(String(log.id))} className="btn-secondary min-h-8 gap-2 px-3 py-1 text-xs"><Link2 className="h-3.5 w-3.5" /> {copy.link}</button></div>)}</div>{manualFuelLogOptions.length < manualFuelLogMatches.length ? <button type="button" onClick={() => setVisibleManualFuelLogCount((count) => count + 10)} className="btn-secondary w-full min-h-9 px-3 py-1.5 text-xs">{copy.loadMore}</button> : null}</div> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {selectedTripTab === "notes" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="form-field"><label className="form-label">{copy.waitingIdleNotes}</label><textarea rows={5} value={form.waiting_idle_notes} onChange={(event) => updateForm("waiting_idle_notes", event.target.value)} className="form-textarea bg-white" /></div>
                <div className="form-field"><label className="form-label">{copy.extraRouteNotes}</label><textarea rows={5} value={form.extra_route_notes} onChange={(event) => updateForm("extra_route_notes", event.target.value)} className="form-textarea bg-white" /></div>
                <button type="button" onClick={() => void handleSaveTrip()} disabled={saving} className="btn-primary gap-2 lg:col-span-2"><Save className="h-4 w-4" />{saving ? copy.saving : copy.saveTrip}</button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
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

        {summary.completedTrips < 2 ? <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">{copy.moreCompletedTripsNeeded}</p> : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.bestKmLDriver}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.bestDriverByKmPerLitre?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.bestDriverByKmPerLitre?.kmPerLitre, 2)} {copy.kmL}</p></div>
          <div className={metricTileClass("green")}><p className="text-xs font-semibold opacity-80">{copy.lowestCostKmDriver}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.lowestCostDriver?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatCurrency(summary.lowestCostDriver?.costPerKm)}</p></div>
          <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.bestVehicle}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.bestVehicleByKmPerLitre?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.bestVehicleByKmPerLitre?.kmPerLitre, 2)} {copy.kmL}</p></div>
          <div className={metricTileClass("purple")}><p className="text-xs font-semibold opacity-80">{copy.lowestVehicleCostKm}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.lowestCostVehicle?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatCurrency(summary.lowestCostVehicle?.costPerKm)}</p></div>
          <div className={metricTileClass("amber")}><p className="text-xs font-semibold opacity-80">{copy.mostExpensiveTrip}</p><p className="mt-1 truncate font-bold text-slate-950">{summary.mostExpensiveTrip ? getShortRoutePreview(summary.mostExpensiveTrip.trip, copy) : "-"}</p><p className="text-xs text-slate-500">{formatCurrency(summary.mostExpensiveTrip?.metrics.costPerKm)}</p></div>
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
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">{copy.rank}</th><th className="px-3 py-3 text-left">{comparisonTab === "drivers" ? copy.driver : copy.vehicleRegistration}</th><th className="px-3 py-3 text-right">{copy.completed}</th><th className="px-3 py-3 text-right">{copy.actualKm}</th><th className="px-3 py-3 text-right">{copy.litres}</th><th className="px-3 py-3 text-right">{copy.fuelCost}</th><th className="px-3 py-3 text-right">{copy.avgKmL}</th><th className="px-3 py-3 text-right">{copy.avgCostKm}</th><th className="px-3 py-3 text-right">{copy.estimatedVsActual}</th><th className="px-3 py-3 text-left">{copy.label}</th></tr></thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {(comparisonTab === "drivers" ? sortedDriverRows : sortedVehicleRows).map((row, index) => <tr key={row.name} className="transition hover:bg-brand-50/45"><td className="px-3 py-3 font-bold text-slate-950">#{index + 1}</td><td className="px-3 py-3 font-bold text-slate-950">{row.name}</td><td className="px-3 py-3 text-right font-semibold">{row.completedTrips}</td><td className="px-3 py-3 text-right">{formatNumber(row.actualKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.litres, 2)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.cost)}</td><td className="px-3 py-3 text-right font-semibold">{formatNumber(row.kmPerLitre, 2)}</td><td className="px-3 py-3 text-right font-semibold">{formatCurrency(row.costPerKm)}</td><td className="px-3 py-3 text-right">{row.estimatedKm > 0 ? `${formatNumber(((row.actualKm - row.estimatedKm) / row.estimatedKm) * 100, 1)}%` : "-"}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel, copy)}`}>{row.performanceLabel}</span></td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:hidden">
              {(comparisonTab === "drivers" ? sortedDriverRows : sortedVehicleRows).map((row, index) => <article key={row.name} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">#{index + 1}</p><h4 className="mt-1 font-bold text-slate-950">{row.name}</h4></div><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel, copy)}`}>{row.performanceLabel}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">{copy.completed}</p><p className="font-bold">{row.completedTrips}</p></div><div><p className="text-xs text-slate-500">{copy.actualKm}</p><p className="font-bold">{formatNumber(row.actualKm)}</p></div><div><p className="text-xs text-slate-500">{copy.litres}</p><p className="font-bold">{formatNumber(row.litres, 2)}</p></div><div><p className="text-xs text-slate-500">{copy.fuelCost}</p><p className="font-bold">{formatCurrency(row.cost)}</p></div><div><p className="text-xs text-slate-500">{copy.avgKmL}</p><p className="font-bold">{formatNumber(row.kmPerLitre, 2)}</p></div><div><p className="text-xs text-slate-500">{copy.avgCostKm}</p><p className="font-bold">{formatCurrency(row.costPerKm)}</p></div></div></article>)}
            </div>
          </div>
        ) : null}

        {comparisonTab === "routes" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">{copy.route}</th><th className="px-3 py-3 text-right">{copy.trips}</th><th className="px-3 py-3 text-right">{copy.avgEstKm}</th><th className="px-3 py-3 text-right">{copy.avgActualKm}</th><th className="px-3 py-3 text-right">{copy.avgDifference}</th><th className="px-3 py-3 text-right">{copy.avgFuelCost}</th><th className="px-3 py-3 text-right">{copy.avgCostKm}</th><th className="px-3 py-3 text-right">{copy.avgKmL}</th><th className="px-3 py-3 text-left">{copy.label}</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{sortedRouteRows.map((row) => <tr key={row.route} className="transition hover:bg-brand-50/45"><td className="max-w-[280px] px-3 py-3 font-bold text-slate-950"><span className="line-clamp-2">{row.route}</span></td><td className="px-3 py-3 text-right">{row.completedTrips}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageEstimatedKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageActualKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageDifferenceKm)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.averageFuelCost)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.costPerKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.kmPerLitre, 2)}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel, copy)}`}>{row.performanceLabel}</span></td></tr>)}</tbody></table></div>
        ) : null}

        {comparisonTab === "trips" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">{copy.date}</th><th className="px-3 py-3 text-left">{copy.route}</th><th className="px-3 py-3 text-left">{copy.driver}</th><th className="px-3 py-3 text-left">{copy.vehicle}</th><th className="px-3 py-3 text-right">{copy.actualKm}</th><th className="px-3 py-3 text-right">{copy.estimatedKm}</th><th className="px-3 py-3 text-right">{copy.difference}</th><th className="px-3 py-3 text-right">{copy.litres}</th><th className="px-3 py-3 text-right">{copy.fuelCost}</th><th className="px-3 py-3 text-right">{copy.kmL}</th><th className="px-3 py-3 text-right">{copy.costKm}</th><th className="px-3 py-3 text-left">{copy.label}</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{sortedTripRows.map((row) => <tr key={row.trip.id} className="transition hover:bg-brand-50/45"><td className="px-3 py-3">{formatDate(row.trip.trip_date)}</td><td className="max-w-[260px] px-3 py-3 font-bold text-slate-950"><span className="line-clamp-2">{getShortRoutePreview(row.trip, copy)}</span></td><td className="px-3 py-3">{row.trip.driver || "-"}</td><td className="px-3 py-3">{row.trip.vehicle_reg || row.trip.vehicle_type || "-"}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.actualDistance)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.estimatedDistance)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.differenceKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.fuel.litres, 2)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.metrics.fuel.cost)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.kmPerLitre, 2)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.metrics.costPerKm)}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.label, copy)}`}>{row.label}</span></td></tr>)}</tbody></table></div>
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
