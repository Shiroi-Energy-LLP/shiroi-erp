# Screen: Project List

## Purpose
View, search, and filter all solar projects in the system. Provides a high-level table view of project status, capacity, and timelines.

## User
Project Manager / Administrator

## UI Structure
### Layout
- **Header**: Title and "Add Project" button.
- **Filters**:
  - Search bar (Project Name, Client ID, Location)
  - Status filter dropdown (All, Planning, Survey, BOI, Execution, Completed)
  - System Size filter dropdown (All, < 10kWp, 10-50kWp, > 50kWp)
- **Project Table**: Detailed list of projects.

### Components
- **ProjectRow**:
  - Client ID
  - Project Name
  - System Size (kWp)
  - Location
  - Status (Badge)
  - % Complete (Progress bar)
  - Start Date
  - End Date
  - Remarks

## Data Model Mapping
### Data
- `projects`: Array of Project objects.
- `filteredProjects`: Computed array based on search and filter criteria.
- `project`:
  - `id` (string)
  - `clientId` (string)
  - `name` (string)
  - `systemSize` (number)
  - `location` (string)
  - `status` (string)
  - `percentComplete` (number)
  - `startDate` (string)
  - `endDate` (string)
  - `remarks` (string)

## Actions
- **Search**: Real-time filtering by text.
- **Filter**: Dropdown selection for status and size.
- **Add Project**: Opens a form to create a new project.
- **View Details**: Click on a project row to navigate to the Project Detail view.

## States
- **Loading**: Fetching projects.
- **Empty**: No projects found matching filters.
- **Success**: Table populated with project rows.
