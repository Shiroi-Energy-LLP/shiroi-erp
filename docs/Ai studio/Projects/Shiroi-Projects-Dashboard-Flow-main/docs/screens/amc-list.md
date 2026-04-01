# Screen: AMC List

## Purpose
Track and manage Annual Maintenance Contracts (AMC) for solar projects, including free and paid visits.

## User
Service Manager / Project Manager

## UI Structure
### Layout
- **Header**: Title, "Add AMC Record" button, search bar, and category filter.
- **AMC Table**: Detailed list of AMC records.

### Components
- **AMCRow**:
  - Project Name (Name, Icon)
  - Type (Free/Paid)
  - Category (Badge: Free AMC, Paid AMC)
  - Assigned To (Engineer Name, Icon)
  - Action Date (Date, Icon)
  - Report (View Report button)
  - Delete Action (Trash Icon)

## Data Model Mapping
### Data
- `amcs`: Array of AMCRecord objects.
- `filteredAMCs`: Computed array based on search and category filter.
- `amc`:
  - `id` (string)
  - `projectName` (string)
  - `type` (string)
  - `category` (string)
  - `assignedTo` (string)
  - `actionDate` (string)
  - `reportUrl` (string)

## Actions
- **Search**: Filter AMCs by project name.
- **Filter**: Dropdown selection for AMC category.
- **Add AMC**: Opens a form to create a new AMC record.
- **View Report**: Opens the associated AMC report.
- **Delete AMC**: Removes an AMC record from the list.

## States
- **Loading**: Fetching AMC records.
- **Empty**: No AMC records found matching filters.
- **Success**: Table populated with AMC rows.
