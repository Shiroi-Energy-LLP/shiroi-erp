# Screen: Project Detail

## Purpose
Comprehensive view and management of a single solar project's lifecycle, from site survey to commissioning and AMC.

## User
Project Manager / Site Engineer / Liaison Officer

## UI Structure
### Layout
- **Header**: Project name, status, and back button.
- **Stepper**: 9-step navigation bar (Survey, BOI, Budget, Execution, QC, Liaison, Commissioning, AMC).
- **Tab Content Area**: Dynamic content based on the active step.

### Components
- **Stepper**:
  - Step icon and label.
  - Active/Completed/Pending states.
- **ProjectDetailsTab**:
  - Client Info (Name, ID, Contact, Address).
  - Technical Specs (System Size, Panel Type, Inverter, Structure).
  - Financial Overview (Budget, Actual, Profit).
- **SiteSurveyTab**:
  - Site Details (Roof Type, Orientation, Shading).
  - Electrical Details (MCB, Earthing, Cable Length).
  - Documents (Photos, Layout).
- **BOITab**:
  - Bill of Items table (Item, Spec, Qty, Unit).
  - "Send to Purchase Team" action.
- **BudgetAnalysisTab**:
  - BOQ vs Actual Budget table.
  - Summary cards (Total Budget, Actual, Variance).
- **ExecutionTab**:
  - Milestone list (Structure, Wiring, Inverter, Testing).
  - Task completion checkboxes and dates.
- **QualityCheckTab**:
  - Checklist (Panel Alignment, Wiring, Earthing, Safety).
  - Pass/Fail status and remarks.
- **LiasonningTab**:
  - Process list (Application, Feasibility, Inspection, Net Meter).
  - Status tracking and document uploads.
- **CommissioningTab**:
  - Final checks (System ON, Generation Test, Handover).
  - Commissioning date and certificate.
- **AMCTab**:
  - AMC Status (Free/Paid).
  - Schedule view and service history.

## Data Model Mapping
### Data
- `project`: Single Project object.
- `step`: Current active step index (0-8).
- `survey`: Site survey details.
- `boi`: Array of Bill of Items.
- `budget`: Budget analysis data.
- `execution`: Array of execution tasks.
- `qualityCheck`: Checklist results.
- `liasonning`: Liaison process status.
- `commissioning`: Final commissioning data.
- `amc`: AMC records and schedule.

## Actions
- **Navigate Steps**: Click on stepper icons to switch tabs.
- **Update Status**: Toggle checkboxes or select status in each tab.
- **Save Changes**: (Implicit) Updates project state.
- **Export PDF**: (Placeholder) Generate project report.

## States
- **Loading**: Fetching project details.
- **Step Transition**: Smooth motion animations between tabs.
- **Success**: Detailed project data rendered.
