"""Checklist templates. Sent to the device once so new inspections can be started offline."""

TEMPLATES = [
    {
        "kind": "fire_safety",
        "name": "Fire safety round",
        "items": [
            "Fire extinguishers present, charged and in date",
            "Exit routes clear and exit signs lit",
            "Assembly point marked and reachable",
            "Smoke detectors and alarm panel working",
            "Hose reels and hydrants easy to reach",
            "Hot-work permits displayed at the work area",
            "Flammable material kept in approved cabinets",
            "Emergency contact list displayed",
        ],
    },
    {
        "kind": "electrical",
        "name": "Electrical safety",
        "items": [
            "Main panel closed, labelled and not blocked",
            "Earthing and RCCB trip test recorded",
            "No exposed or taped cable joints",
            "Temporary wiring on insulated stands, not on the floor",
            "Portable tools have a valid test tag",
            "Lockout-tagout used on equipment being serviced",
            "Panel room has rubber mat and insulated gloves",
            "DG set exhaust and fuel storage safe",
        ],
    },
    {
        "kind": "scaffolding",
        "name": "Scaffolding and work at height",
        "items": [
            "Base plates and sole boards firm",
            "Standards plumb and braced",
            "Working platform fully boarded, no gaps",
            "Guard rails and toe boards in place",
            "Safe access ladder, tied at the top",
            "Green scaffold tag signed this week",
            "Workers wearing full-body harness, anchored",
            "Edge protection at slab openings",
            "Debris net fitted and drop zone barricaded",
        ],
    },
    {
        "kind": "housekeeping",
        "name": "Housekeeping and welfare",
        "items": [
            "Walkways clear of material and cables",
            "Waste separated and bins not overflowing",
            "Drinking water and wash area clean",
            "First-aid box stocked and checked",
            "PPE in use: helmets, shoes and vests",
            "Material stacked and secured",
            "Toilets clean and lit",
            "Daily toolbox talk recorded",
        ],
    },
]

KINDS = [t["kind"] for t in TEMPLATES]
