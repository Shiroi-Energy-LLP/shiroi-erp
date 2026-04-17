# Screen: Task List

## Purpose
View and manage individual tasks across all solar projects, focusing on execution milestones and assignments.

## User
Site Engineer / Project Manager

## UI Structure
### Layout
- **Header**: Search bar and status filter.
- **Task Table**: Detailed list of tasks.

### Components
- **TaskRow**:
  - Task Description (Description, Category)
  - Project (Project Name, Icon)
  - Assigned To (Engineer Name, Icon)
  - Date (Assigned Date, Icon)
  - Status (Badge: Pending, In Progress, Completed)

## Data Model Mapping
### Data
- `projects`: Array of Project objects.
- `allTasks`: Computed array of tasks extracted from all projects' `execution` arrays.
- `filteredTasks`: Computed array based on search and status filter.
- `task`:
  - `id` (string)
  - `category` (string)
  - `description` (string)
  - `assignedTo` (string)
  - `assignedDate` (string)
  - `status` (string)
  - `projectName` (string)
  - `projectId` (string)

## Actions
- **Search**: Filter tasks by description or project name.
- **Filter**: Dropdown selection for task status.
- **View Project**: Click on project name to navigate to project details.

## States
- **Loading**: Extracting tasks from projects.
- **Empty**: No tasks found matching filters.
- **Success**: Table populated with task rows.
