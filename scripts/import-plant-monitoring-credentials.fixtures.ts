// scripts/import-plant-monitoring-credentials.fixtures.ts
//
// Anonymized rows from the 2026-05-23 credentials dump. Used by unit tests
// to verify parser + matcher without hitting the DB.

export const FIXTURE_RAW_ROWS = [
  {
    project: 'GRN Ambili Srinivas',
    brand: 'Sungrow',
    username: 'venkatms@example.com',
    password: 'Solar123',
    monitoringLink: 'https://www.isolarcloud.com.hk/#/login',
    created: '2025-11-21',
  },
  {
    project: 'Mr Ravi / Tiruvannamalai',
    brand: 'Deye',
    username: 'raguramanradha1957@example.com',
    password: 'Solar12345',
    monitoringLink: 'https://home.solarmanpv.com/login',
    created: '12/3/2025',
  },
  {
    project: 'Mr Sridhar Rajan',
    brand: 'Deye',
    username: 'Sridharrajan1989@example.com',
    password: 'Solar@123',
    monitoringLink: 'https://home.solarmanpv.com/login',
    created: '4/18/2026',
  },
];

export const FIXTURE_PROJECTS = [
  { id: '11111111-1111-1111-1111-111111111111', customer_name: 'GRN Ambili Srinivas', project_number: 'SHIROI/PROJ/2025-26/0010' },
  { id: '22222222-2222-2222-2222-222222222222', customer_name: 'Mr Ravi', project_number: 'SHIROI/PROJ/2025-26/0020' },
  { id: '33333333-3333-3333-3333-333333333333', customer_name: 'Sridhar Rajan', project_number: 'SHIROI/PROJ/2026-27/0030' },
  { id: '44444444-4444-4444-4444-444444444444', customer_name: 'Some Unrelated', project_number: 'SHIROI/PROJ/2026-27/0040' },
];
