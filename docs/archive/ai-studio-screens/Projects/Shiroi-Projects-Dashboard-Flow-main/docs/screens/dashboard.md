# Screen: Dashboard

## Purpose
High-level overview of the entire solar project portfolio, including system capacity, client metrics, sales performance, and operational status.

## User
Project Manager / Administrator

## UI Structure
### Layout
- **Top Stats Grid**: 4 cards showing key performance indicators.
- **Main Content Area**:
  - **Project Status Overview**: Pie chart showing distribution of projects by status.
  - **Operational Stats**: Progress bars for open tasks, services, and AMC visits.
  - **Today's Tasks**: Quick list of active projects for immediate attention.

### Components
- **StatCard**:
  - Icon (Sun, Users, DollarSign, TrendingUp)
  - Title
  - Value (kWp, Count, Currency, Percentage)
  - Trend Indicator (Percentage change/description)
- **PieChart**: Recharts implementation for project status.
- **OpStat**: Progress bar component with label, value, and total.
- **TaskItem**: Simple row showing project name, location, and status.

## Data Model Mapping
### Data
- `projects`: Array of Project objects.
- `services`: Array of ServiceRecord objects.
- `amcs`: Array of AMCRecord objects.
- `stats`: Computed object containing:
  - `totalSystemSize` (kWp)
  - `uniqueClients` (Count)
  - `totalSales` (Currency)
  - `avgProfitPct` (Percentage)
  - `openTasks` (Count)
  - `openServices` (Count)
  - `amcsThisMonth` (Count)

## Actions
- **View Project**: Click on a task in "Today's Tasks" or a chart segment to navigate to project details.
- **Timeframe Filtering**: (Implicit) Stats are calculated based on current month/year.

## States
- **Loading**: Initial data fetch.
- **Empty**: No projects or records found.
- **Success**: Rendered charts and stats.
