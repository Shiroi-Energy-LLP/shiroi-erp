# Screen: Expense List

## Purpose
Track and manage expenses across all solar projects, including travel, food, and material purchases.

## User
Project Manager / Accountant / Site Engineer

## UI Structure
### Layout
- **Total Expenses Card**: Summary of total expenses.
- **Header**: Title, "Add Expense" button, search bar, and category filter.
- **Expense Table**: Detailed list of expenses.

### Components
- **ExpenseRow**:
  - Project Name (Name, Icon)
  - Category (Badge: Travel, Food, Material, Transport, etc.)
  - Description (Description, Voucher No)
  - Engineer (Engineer Name, Icon)
  - Amount (Currency)
  - Status (Badge: Pending, Approved, Rejected)
  - Actions (View Receipt, Delete)

## Data Model Mapping
### Data
- `projects`: Array of Project objects.
- `allExpenses`: Computed array of expenses extracted from all projects' `expenses` arrays.
- `filteredExpenses`: Computed array based on search and category filter.
- `totalAmount`: Sum of all filtered expense amounts.
- `expense`:
  - `id` (string)
  - `category` (string)
  - `description` (string)
  - `engineerName` (string)
  - `voucherNo` (string)
  - `amount` (number)
  - `status` (string)
  - `projectName` (string)
  - `projectId` (string)

## Actions
- **Search**: Filter expenses by description or project name.
- **Filter**: Dropdown selection for expense category.
- **Add Expense**: Opens a form to create a new expense record.
- **View Receipt**: Opens the associated expense receipt.
- **Delete Expense**: Removes an expense record from the list.

## States
- **Loading**: Extracting expenses from projects.
- **Empty**: No expenses found matching filters.
- **Success**: Table populated with expense rows.
