export type Scenario =
  | "ROUTINE_MAINTENANCE"
  | "HIGH_DOLLAR_DIAGNOSTIC"
  | "WARRANTY_REPAIR"
  | "MULTI_LINE_MAJOR_REPAIR"
  | "PII_IN_SEMANTIC"
  | "REPEAT_VISIT";

export const SCENARIO_DISTRIBUTION: Record<Scenario, number> = {
  ROUTINE_MAINTENANCE: 300,
  HIGH_DOLLAR_DIAGNOSTIC: 150,
  WARRANTY_REPAIR: 150,
  MULTI_LINE_MAJOR_REPAIR: 200,
  PII_IN_SEMANTIC: 100,
  REPEAT_VISIT: 100
};

export type ScenarioParams = {
  laborLines: [number, number];
  partsPerLabor: [number, number];
  hoursRange: [number, number];
  totalRange: [number, number];
  warranty: boolean;
  allowPiiInSemantic: boolean;
  repeatVisit: boolean;
};

export const SCENARIO_PARAMS: Record<Scenario, ScenarioParams> = {
  ROUTINE_MAINTENANCE: {
    laborLines: [1, 1],
    partsPerLabor: [0, 1],
    hoursRange: [0.5, 1.0],
    totalRange: [150, 300],
    warranty: false,
    allowPiiInSemantic: false,
    repeatVisit: false
  },
  HIGH_DOLLAR_DIAGNOSTIC: {
    laborLines: [1, 1],
    partsPerLabor: [0, 1],
    hoursRange: [6, 10],
    totalRange: [1500, 3000],
    warranty: false,
    allowPiiInSemantic: false,
    repeatVisit: false
  },
  WARRANTY_REPAIR: {
    laborLines: [1, 2],
    partsPerLabor: [1, 2],
    hoursRange: [1, 4],
    totalRange: [0, 50],
    warranty: true,
    allowPiiInSemantic: false,
    repeatVisit: false
  },
  MULTI_LINE_MAJOR_REPAIR: {
    laborLines: [3, 5],
    partsPerLabor: [1, 4],
    hoursRange: [8, 25],
    totalRange: [3000, 8000],
    warranty: false,
    allowPiiInSemantic: false,
    repeatVisit: false
  },
  PII_IN_SEMANTIC: {
    laborLines: [1, 2],
    partsPerLabor: [0, 2],
    hoursRange: [0.5, 2.5],
    totalRange: [200, 900],
    warranty: false,
    allowPiiInSemantic: true,
    repeatVisit: false
  },
  REPEAT_VISIT: {
    laborLines: [1, 2],
    partsPerLabor: [0, 2],
    hoursRange: [0.5, 2.5],
    totalRange: [200, 900],
    warranty: false,
    allowPiiInSemantic: false,
    repeatVisit: true
  }
};

export type TextTemplateSet = {
  complaints: string[];
  technicianNotes: string[];
  causes: string[];
  corrections: string[];
  opDescriptions: string[];
  partDescriptions: string[];
  advisorNotes: string[];
};

export const DEFAULT_TEMPLATES: TextTemplateSet = {
  complaints: [
    "Customer reports squealing brakes at low speed.",
    "Vehicle pulls to the right during braking.",
    "Customer requests routine oil and filter change.",
    "Noticeable vibration at highway speeds.",
    "Intermittent no-start reported after hot soak.",
    "Customer notes rough idle on cold starts.",
    "Oil service reminder displayed on dash.",
    "Rattle noise from front suspension over bumps."
  ],
  technicianNotes: [
    "Inspected system and verified concern.",
    "Road test performed; concern confirmed.",
    "No additional issues noted at this time.",
    "Fluid levels checked and topped off.",
    "Found worn components requiring replacement.",
    "Performed multi-point inspection."
  ],
  causes: [
    "Brake pad wear beyond service limit.",
    "Contaminated or aged fluid.",
    "Loose suspension fastener.",
    "Intermittent sensor signal drop.",
    "Battery terminal corrosion."
  ],
  corrections: [
    "Replaced brake pads and hardware.",
    "Performed fluid service and test drive.",
    "Torque fasteners to specification.",
    "Replaced faulty sensor and cleared codes.",
    "Cleaned terminals and verified charging."
  ],
  opDescriptions: [
    "Replace front brake pads",
    "Perform diagnostic inspection",
    "Oil and filter service",
    "Inspect suspension components",
    "Replace battery cable end"
  ],
  partDescriptions: [
    "Front brake pad set",
    "Oil filter",
    "Engine oil",
    "Battery cable end",
    "Suspension bushing kit",
    "Brake fluid",
    "Air filter"
  ],
  advisorNotes: [
    "Recommended follow-up service next visit.",
    "Customer advised of findings.",
    "Vehicle returned to customer after verification."
  ]
};

export const DIAGNOSTIC_TEMPLATES: TextTemplateSet = {
  complaints: [
    "Customer reports intermittent loss of power under load.",
    "Vehicle occasionally stalls at idle after warm-up.",
    "Intermittent warning light with no stored codes.",
    "Hard-to-reproduce misfire at highway speed."
  ],
  technicianNotes: [
    "Extended road test required to duplicate condition.",
    "Performed signal monitoring; intermittent fault observed.",
    "Multiple checks required due to intermittent symptoms."
  ],
  causes: [
    "Intermittent fuel delivery issue.",
    "Sensor signal dropout under load.",
    "Loose electrical connection."
  ],
  corrections: [
    "Repaired wiring and verified signal stability.",
    "Replaced suspect component and verified operation.",
    "Updated calibration and confirmed no fault return."
  ],
  opDescriptions: [
    "Perform advanced diagnostic testing"
  ],
  partDescriptions: [
    "Diagnostic connector",
    "Harness repair kit"
  ],
  advisorNotes: [
    "Customer informed that condition is intermittent; extended testing performed."
  ]
};

export const MAJOR_REPAIR_TEMPLATES: TextTemplateSet = {
  complaints: [
    "Customer reports loud knocking from engine under acceleration.",
    "Transmission slipping between gears.",
    "Severe vibration and clunking when turning.",
    "Overheating under normal driving conditions."
  ],
  technicianNotes: [
    "Multiple systems affected; extensive teardown required.",
    "Component wear beyond service limits.",
    "Road test confirms drivetrain concern."
  ],
  causes: [
    "Internal engine component failure.",
    "Transmission clutch pack wear.",
    "Front suspension joint wear.",
    "Cooling system restriction."
  ],
  corrections: [
    "Replaced damaged components and verified operation.",
    "Rebuilt subsystem and performed adaptation procedure.",
    "Replaced worn assemblies and aligned vehicle."
  ],
  opDescriptions: [
    "Engine repair and reassembly",
    "Transmission service and road test",
    "Suspension rebuild"
  ],
  partDescriptions: [
    "Engine gasket set",
    "Timing chain kit",
    "Suspension control arm",
    "Transmission filter",
    "Radiator"
  ],
  advisorNotes: [
    "Major repair authorized by customer.",
    "Extended repair time communicated."
  ]
};

export const WARRANTY_TEMPLATES: TextTemplateSet = {
  complaints: [
    "Customer reports warning light during warranty period.",
    "Customer requests warranty repair for factory issue."
  ],
  technicianNotes: [
    "Verified warranty coverage and performed repair.",
    "Warranty procedure followed as required."
  ],
  causes: [
    "Factory component defect.",
    "Premature wear under warranty coverage."
  ],
  corrections: [
    "Replaced component under warranty.",
    "Performed warranty service per bulletin."
  ],
  opDescriptions: [
    "Warranty repair procedure"
  ],
  partDescriptions: [
    "Warranty replacement part"
  ],
  advisorNotes: [
    "Warranty claim filed."
  ]
};
