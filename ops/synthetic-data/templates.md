# Synthetic RO Templates

## Common Placeholders
- <VEHICLE_MODEL>
- <MODEL_YEAR>
- <ENGINE_TYPE>
- <MILEAGE_RANGE>
- <RO_DATE_RANGE>
- <SYMPTOM_PHRASE>
- <CONDITION_PHRASE>
- <DIAG_ACTION>
- <ROOT_CAUSE>
- <REPAIR_ACTION>
- <OUTCOME_PHRASE>

## Narrative Structure

### Customer Complaint
- "Customer reports <SYMPTOM_PHRASE> on <MODEL_YEAR> <VEHICLE_MODEL> with <ENGINE_TYPE>."
- "Issue occurs <CONDITION_PHRASE>; vehicle within <MILEAGE_RANGE>."
- "Customer notes <SYMPTOM_PHRASE> started within <RO_DATE_RANGE>."

### Technician Diagnosis
- "Verified concern: <SYMPTOM_PHRASE> reproduced under <CONDITION_PHRASE>."
- "Performed <DIAG_ACTION>; findings indicate <ROOT_CAUSE>."
- "Ruled out related causes: <DIAG_ACTION> did not show fault."

### Repair Resolution
- "Completed repair: <REPAIR_ACTION>."
- "Post-repair verification: <SYMPTOM_PHRASE> no longer present under <CONDITION_PHRASE>."
- "Outcome: <OUTCOME_PHRASE>."

## Overlap Guidance
- Use repeated <SYMPTOM_PHRASE> and <CONDITION_PHRASE> across multiple ROs with different <ROOT_CAUSE> values.
- Keep similar diagnosis steps but vary <REPAIR_ACTION> to create near-duplicate language with different outcomes.
- Reuse complaint wording across vehicle placeholders to force retrieval disambiguation.
