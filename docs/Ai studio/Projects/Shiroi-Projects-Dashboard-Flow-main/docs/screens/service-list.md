# Screen: Service List

## Purpose
Track and manage service requests, maintenance visits, and troubleshooting records for all solar projects.

## User
Service Engineer / Project Manager

## UI Structure
### Layout
- **Header**: Title, "Add Service" button, search bar, and status filter.
- **Service Table**: Detailed list of service records.

### Components
- **ServiceRow**:
  - Project Name (Name, Icon)
  - Description (Description, Create Date)
  - Assigned To (Engineer Name, Action Date)
  - Amount (Currency)
  - Status (Badge: Open, In Progress, Closed)
  - Delete Action (Trash Icon)

## Data Model Mapping
### Data
- `services`: Array of ServiceRecord objects.
- `filteredServices`: Computed array based on search and status filter.
- `service`:
  - `id` (string)
  - `projectName` (string)
  - `description` (string)
  - `createDate` (string)
  - `assignedTo` (string)
  - `actionDate` (string)
  - `amount` (number)
  - `status` (string)

## Actions
- **Search**: Filter services by description or project name.
- **Filter**: Dropdown selection for service status.
- **Add Service**: Opens a form to create a new service record.
- **Delete Service**: Removes a service record from the list.

## States
- **Loading**: Fetching service records.
- **Empty**: No service records found matching filters.
- **Success**: Table populated with service rows.
