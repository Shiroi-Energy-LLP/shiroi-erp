/**
 * count-plant-credentials.ts
 *
 * Parses Vivek's pasted credential dump (2026-06-05), classifies each row's
 * brand by portal URL (with brand-column fallback), dedupes, and writes:
 *
 *   scripts/data/credentials-brand-counts-2026-06-05.md
 *
 * Counts both PLANTS (one per project_label after dedupe) and INVERTERS
 * (one per row before multi-inverter collapse). This is what Vivek needs
 * to prioritize Sungrow/Growatt-style API integration for the other brands.
 *
 * Brand classification rules (single source of truth):
 *   solarmanpv.com / solarman → deye   (the key reclassification)
 *   isolarcloud               → sungrow
 *   server.growatt.com        → growatt
 *   auroravision              → fimer
 *   polycabmonitoring         → polycab
 *   power-datacenter          → flin_energy
 *   solarweb / fronius        → fronius
 *   havells                   → havells
 *   (no URL)                  → fallback to normalized brand column
 *
 * Dedup rule: (normalized_label, brand, normalized_username) — latest by
 * created date wins; if no date, last-paste-order wins.
 *
 * Usage: pnpm tsx scripts/count-plant-credentials.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Raw data: from Vivek's paste 2026-06-05
// Columns: project | brand | username | password | url | created
// Empty fields are '' — paste-order is preserved.
// ─────────────────────────────────────────────────────────────────────────

interface RawRow {
  project: string;
  brand: string;
  username: string;
  password: string;
  url: string;
  created: string;
}

const RAW: RawRow[] = [
  { project: 'GRN Ambili Srinivas', brand: 'Sungrow', username: 'venkatms@rediffmail.com', password: 'Solar123', url: 'https://www.isolarcloud.com.hk/#/login', created: '2025-11-21' },
  { project: 'Mr Ravi / Tiruvannamalai', brand: 'Deye', username: 'raguramanradha1957@gmail.com', password: 'Solar12345', url: 'https://home.solarmanpv.com/login', created: '2025-12-03' },
  { project: 'GRN Ambili Srinivas', brand: 'Sungrow', username: 'venkatms@rediffmail.com', password: 'Solar123', url: '', created: '2025-11-20' },
  { project: 'Mr Sukumaran', brand: 'Deye', username: 'divyakalu@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2025-09-18' },
  { project: 'Mr Rangachari', brand: 'Deye', username: 'anand.Rangachari@gmail.com', password: 'vedika!123', url: 'https://home.solarmanpv.com/login', created: '2025-10-14' },
  { project: 'Mr Arjun Prasath', brand: 'Deye', username: 'krithiha.arjun@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2025-11-11' },
  { project: 'Mr Sivasankar', brand: 'Deye', username: 'assikadusiva@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2025-11-14' },
  { project: 'Mr Sanjay', brand: 'Havells', username: 'swatantrajaiswal30@gmail.com', password: 'Solar123', url: '', created: '2025-09-02' },
  { project: 'Mr. Ramesh Babu', brand: 'Deye', username: 'ramesh.babu@hotmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2025-10-30' },
  { project: 'Sri Ganapathy Ashram, Phase II', brand: 'Deye', username: 'ushasankaran1961@gmail.com', password: 'Solar123#', url: 'https://home.solarmanpv.com/login', created: '2025-08-18' },
  { project: 'Shiroi Energy', brand: 'Sungrow', username: 'manivel@shiroienergy.com', password: 'shiro@2025', url: 'https://www.isolarcloud.com.hk/#/login', created: '2025-12-01' },
  { project: 'Shiroi Energy', brand: 'Growatt', username: 'EEVUWE001', password: 'Solar123', url: 'https://server.growatt.com/login', created: '2025-12-01' },
  { project: 'Mr Venkatraman', brand: '', username: 'bluetbmvs@gmail.com', password: 'Solar123', url: '', created: '2025-12-01' },
  { project: 'MSM Unit II , Phase II / 400 KWp', brand: '', username: 'mrinalstores_msm@yahoo.com', password: 'Mrinal@123', url: 'https://www.isolarcloud.com.hk/#/login', created: '2025-12-01' },
  { project: 'Mr Felix Johnson', brand: 'Deye', username: 'nancysweetline@gmail.com', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Dr Ramesh / 5 kWp', brand: 'Deye', username: 'dr.rramesh@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Shiroi Energy', brand: 'Deye', username: 'manivel@shiroienergy.com', password: 'Deye@30#', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Mr Anandan', brand: 'Sungrow', username: 'anandananitha@gmail.com', password: 'Aarthi@1703', url: 'https://www.isolarcloud.com.hk/#/login', created: '' },
  { project: 'Mr Devadoss / 7 KWp', brand: 'Deye', username: 'sdevadoss1891@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Mr Prabakaran / 3.3 KWp', brand: 'Deye', username: 'spn151202@hotmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Mr Chandraprakash', brand: 'Sungrow', username: 'archandraprakash05@gmail.com', password: 'Solar123', url: 'https://www.isolarcloud.com.hk/#/login', created: '' },
  { project: 'Enexio Fill Factory', brand: 'Goodwe', username: 'maintenance@enexioindia.com', password: 'Solar123', url: '', created: '' },
  { project: 'Mr Siva Elango', brand: '', username: 'gsivaelango@yahoo.co.in', password: 'Solar123', url: '', created: '' },
  { project: 'Hindu School Payalwar street', brand: 'Deye', username: 'hssstrip@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Mr Arjun Prasath', brand: 'Deye', username: 'krithiha.arjun@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Mr Davidson', brand: 'Deye', username: 'sondavid@yahoo.com', password: 'Davidson123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish', brand: 'Growatt', username: 'Block - C', password: 'Fl0ur1sh@2026', url: 'https://server.growatt.com/login', created: '' },
  { project: 'CM Construction', brand: 'Havells', username: 'sarav_cms@yahoo.co.in', password: 'Solar12', url: '', created: '' },
  { project: 'Mr Rangachari', brand: 'Deye', username: 'anand.Rangachari@gmail.com', password: 'Vedika!123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Mr Ramaswamy', brand: 'Deye', username: 'sai.chandru2017@gmail.com', password: 'Saisolar123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Mr.Kasinathan', brand: 'Growatt', username: 'kasinathan', password: 'Solar123', url: 'https://server.growatt.com/login', created: '2025-12-06' },
  { project: 'Sri Sayee School', brand: 'Growatt', username: 'srisayee', password: 'Solar123', url: 'https://server.growatt.com/login', created: '2025-12-15' },
  { project: 'Mr Jeyakumar', brand: '', username: 'rjkr123@gmail.com', password: 'Solar123', url: '', created: '2025-12-24' },
  { project: 'Mr Nitin', brand: 'Sungrow', username: 'nitinkadambari@yahoo.co.in', password: 'Solar123', url: 'https://www.isolarcloud.com.hk/#/login', created: '2026-01-04' },
  { project: 'Mr Ashok', brand: 'Fronious', username: 'panchapakesanashok1@gmail.com', password: 'Ashokp@Solar123 / Solar123', url: '', created: '2025-12-22' },
  { project: 'Swarnalatha', brand: 'Deye', username: 'vsl_boss@yahoo.co.in', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2026-01-10' },
  { project: 'Mr Jeyaseelan', brand: '', username: 'jneumarin@gmail.com', password: 'Solar123', url: '', created: '2025-06-20' },
  { project: 'Arihanth Nahar', brand: 'Deye', username: 'm.arihantnahar@gmail.com', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '2025-11-08' },
  { project: 'Mr Sundar', brand: '', username: 'hariram1700@ymail.com', password: 'Solar123', url: '', created: '2026-01-23' },
  { project: 'Oriental Hydraulics Private Limited', brand: 'Goodwe', username: 'mail2@shiori.com', password: 'Solar123', url: '', created: '2026-01-27' },
  { project: 'Hindu School Adyar', brand: 'Fimer', username: 'Hinduschool', password: 'Solar@123', url: 'https://www.auroravision.net/ums/v1/loginPage', created: '2025-11-04' },
  { project: 'Mr.Karthikeyan / CM Constructions', brand: '', username: 'jkarthik.nr@gmail.com', password: 'Solar123', url: '', created: '2026-02-10' },
  { project: 'M/s Latha Ganesh', brand: 'Deye', username: 'latsgana@gmail.com', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '2026-02-19' },
  { project: 'Ceebros Boulevard', brand: 'Growatt', username: 'Cbfoasolar', password: 'Solar123', url: 'https://server.growatt.com/login', created: '2024-04-17' },
  { project: 'Solver Minds / 8 KWp', brand: 'Goodwe', username: 'infraadmin@solverminds.com', password: 'Solver123', url: '', created: '2026-02-20' },
  { project: 'Solver Minds / 81 KWp', brand: 'Fimer', username: 'Solverminds', password: 'Solar@123', url: 'https://www.auroravision.net/ums/v1/loginPage', created: '2026-02-20' },
  { project: 'GVG Industries Private Ltd', brand: 'Goodwe', username: 'Gvgindustries@gmail.com', password: 'Admin@123', url: '', created: '2026-03-02' },
  { project: 'Lancor Hiranmayi', brand: '', username: 'ganasa@hotmail.com', password: 'Solar123', url: '', created: '2026-03-03' },
  { project: 'Mr Koildhass', brand: 'Deye', username: 'kdoss00@yahoo.com', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '2026-03-05' },
  { project: 'Mr Sairam', brand: 'Deye', username: 'vupputursairam@gmail.com', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '2025-05-30' },
  { project: 'Alamelu & Arvind', brand: 'Polycab', username: 'Alusolar', password: 'Hamra@466', url: 'https://pv.polycabmonitoring.com/dist/#/login/index', created: '2026-03-25' },
  { project: 'Mr Sivasankar Home', brand: 'Deye', username: 'sankar_hema@rediffmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2029-03-28' },
  { project: 'Mr Solai Ayyar', brand: 'Deye', username: 'indraayyar10@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2026-04-02' },
  { project: 'Mr Sridhar Rajan', brand: 'Deye', username: 'Sridharrajan1989@gmail.com', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '2026-04-18' },
  { project: 'Mr Deepka Raj', brand: 'Polycab', username: 'Deepakraj', password: 'Solar123', url: 'https://pv.polycabmonitoring.com/dist/#/login/index', created: '2026-04-24' },
  { project: 'M/s Deepa Balaji', brand: 'Polycab', username: 'Balajissolar', password: 'Solar@123', url: 'https://pv.polycabmonitoring.com/dist/#/login/index', created: '2026-05-01' },
  { project: 'Mr Pradheep Boopathy', brand: 'Polycab', username: 'Pradheepsolar', password: 'Solar@123', url: 'https://pv.polycabmonitoring.com/dist/#/login/index', created: '2026-05-01' },
  { project: 'Mr Shanmugam', brand: 'Deye', username: 'spshanmu@gmail.com', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '2026-05-01' },
  { project: 'Krishnaveni', brand: 'Growatt', username: 'Jegan moorthy', password: 'Solar123', url: 'https://server.growatt.com/login', created: '2025-12-03' },
  { project: 'Mr Murali', brand: 'Deye', username: 'kmurali020@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2026-05-09' },
  { project: 'Chettinad Hospital', brand: 'Growatt', username: 'CHETTINADRHC', password: 'Solar123', url: 'https://server.growatt.com/login', created: '2026-05-11' },
  { project: 'Mr Muthu', brand: 'Flin Energy', username: 'Muthu', password: 'Solar123', url: 'http://power-datacenter.com/cmc/login_system.html', created: '2026-05-12' },

  // Radiance Flourish apartments — all Deye on Solarman, all one project
  { project: 'Radiance Flourish / A/A2 - Mrs Nithiya Ramachandran', brand: 'Deye', username: 'Nithyaram', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / A/A3 - Mrs Asumitha', brand: 'Deye', username: 'Ashmitha', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / A/A4 - Mr Venkatramani', brand: 'Deye', username: 'Venkatramani', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / A/A5 & A/A6 - Mr Ravi', brand: 'Deye', username: 'Ravianju', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / B/A1 - Mrs Jayashree', brand: 'Deye', username: 'Jayashri', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / B/A2 - Mr Ramachandran', brand: 'Deye', username: 'Ckram99', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / B/A3 - Mr Nitin', brand: 'Deye', username: 'NitinkumarB3', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / B/A4 - Mr Manoj', brand: 'Deye', username: 'BManoj', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / B/A5 - Mr Gowtham', brand: 'Deye', username: 'Gautham', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / B/A6 - Mr Unnikrishnan', brand: 'Deye', username: 'Unnivalliyil', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / C/A1 - Mr Jayaraman', brand: 'Deye', username: 'JJayabarthi', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / C/A3 - Mrs Shree Latha', brand: 'Deye', username: '', password: '', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / C/A5 - Mrs Geeth Priya', brand: 'Deye', username: 'Geethapriya', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / D/A1 - Mr Sudharsan', brand: 'Deye', username: 'Sutharsan', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / D/A3', brand: 'Deye', username: 'DA3', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / D/A4 - Mr Shajee', brand: 'Deye', username: 'Phshajee', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / E/A1 - Mr Vanagiri', brand: 'Deye', username: 'EA1vanagiri', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / E/A2 - Mr Sekar', brand: 'Deye', username: 'Shekar', password: 'TN37LP8383', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / E/A3 - Mr Ramachandran', brand: 'Deye', username: 'Ramachandrank', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / E/A4 - Mr Sundar Rajan', brand: 'Deye', username: 'Sundarrajan', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / E/A5 - Mrs Rajalakshmi', brand: 'Deye', username: 'Rajalakshmi', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / E/A6 - Mrs Gomathi', brand: 'Deye', username: 'EA6Gomathi', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / F/A1 - Mrs Sripriya', brand: 'Deye', username: 'kanmani', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / F/A2 - Mr Meenakshi Sundaram', brand: 'Deye', username: 'Seyon', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / F/A3 - Mrs Anuradha Ganeshan', brand: 'Deye', username: 'Anuradhaganesh', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / F/A6 - Mrs Vidiya', brand: 'Deye', username: 'Aksmaniyan', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / F/A7 - Mr Mohan', brand: 'Deye', username: 'kMohan', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / F/A8 - Mrs Sridevi Ashokan', brand: 'Deye', username: 'Sridevi ashok', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / F/A9 - Mr Selvarajan', brand: 'Deye', username: 'Selvarajan', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / G/A1 - Mr Ramasamy Annamalai', brand: 'Deye', username: 'GA1', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / G/A2 - Mr Arun', brand: 'Deye', username: 'Arunnithya', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / H/A2 - Mr Bhadri', brand: 'Deye', username: 'HA2', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / H/A3 - Mr Ramasamy', brand: 'Deye', username: 'Ramasamy', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / H/A6 - Mr Durai Murugan', brand: 'Deye', username: 'Nduraimurugan', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / H/A8 - Mr Selvakumar', brand: 'Deye', username: 'Sselvakumar', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / H/A9 - Mrs Latha Ragu', brand: 'Deye', username: 'Raghuvamsham', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / H/A10 - Mr Baskaran', brand: 'Deye', username: 'Dhanamuthu', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / H/A11 - Mr Kumar', brand: 'Deye', username: 'K.kumar', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A1 - Mr Veerasekar', brand: 'Deye', username: 'Veerasekar', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A2 - Mr Ashok', brand: 'Deye', username: 'Ashokja2', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A3 - Mrs Nivetha', brand: 'Deye', username: 'Nivedhasivakumar', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A4 - Mr Nagasubrish', brand: 'Deye', username: 'Nagasabarish', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A5 - Mr Naresh', brand: 'Deye', username: 'Nareshjoghee', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A6', brand: 'Deye', username: 'Geethabalu', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A7', brand: 'Deye', username: 'SPrabhakar', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A8 - Mr Sudha Srivilasan', brand: 'Deye', username: 'Sudhasri', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },
  { project: 'Radiance Flourish / J/A9 - Mr Suresh', brand: 'Deye', username: 'Smitra', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '' },

  { project: 'A L Sekhar', brand: 'Growatt', username: 'AL Sekhar', password: 'Solar123', url: 'https://server.growatt.com/login', created: '2026-05-16' },
  { project: 'Mr.Rajan Babu', brand: 'Growatt', username: 'rajanbabut', password: 'Solar123', url: 'https://server.growatt.com/login', created: '2025-11-22' },
  { project: 'Mr.Sriram Pallikaranai', brand: 'Deye', username: 'balasfinearts@gmail.com', password: 'Solar@123', url: 'https://home.solarmanpv.com/login', created: '2025-10-05' },
  { project: 'Mr Raja grn gopal street', brand: 'Deye', username: 'Jayanthi.raja1964@gmail.com', password: 'Solar123', url: 'https://home.solarmanpv.com/login', created: '2026-06-05' },
  { project: 'vanai Panache', brand: 'Deye', username: 'vinaismav@gmail.com', password: 'Solar@123', url: '', created: '' },
  { project: 'Varun - Besant nagar ( 4.3kw )', brand: 'Deye', username: 'varunp@gmail.com', password: 'Solar@123', url: '', created: '' },
  { project: 'AM RAJA - Besant nagar ( 3.2 KW )', brand: 'Growatt', username: 'Amraja', password: 'Solar123', url: '', created: '' },
  { project: 'Shridhar - Tambaram ( 6 kw )', brand: 'Deye', username: 'shridhar1953@gmail.com', password: 'Solar123', url: '', created: '' },

  // Chemfab Alkalis — multiple inverters at one site, separate logins per setup
  { project: 'Chemfab Alkalis SS_110 KWp', brand: 'Fimer', username: 'Chemfabalkalis', password: 'Solar@123', url: '', created: '' },
  { project: 'Chemfab Alkalis SS_55 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },
  { project: 'Chemfab Alkalis SS_8.7 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },
  { project: 'Chemfab Alkalis DP_11.5 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },
  { project: 'Chemfab Alkalis SP_11.5 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },
  { project: 'Chemfab Alkalis RO_23 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },

  { project: 'Schangalaya_25 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },
  { project: 'Schakaralaya_50 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },
  { project: 'Mountmeru _108KWp', brand: 'Fimer', username: 'Mountmeru_Solar', password: 'Solar@123', url: '', created: '' },
  { project: 'Mountmeru _103 KWp', brand: 'Fimer', username: 'Mountmeru_Solar', password: 'Solar@123', url: '', created: '' },
  { project: 'Harsha_2 KWp', brand: 'Fimer', username: 'harsha123', password: 'Solar@123', url: '', created: '' },
  { project: 'Baskar_2.5 KWp', brand: 'Fimer', username: 'Bossshyam', password: 'Solar2019@', url: '', created: '' },
  { project: 'Ashok_4 KWp', brand: 'Fronius solar web', username: 'mail@shiroienergy.com', password: 'Shiroienergy@04', url: '', created: '' },
  { project: 'Ashok_2.5 KWp', brand: 'Havells', username: 'shravan@shiroienergy.com', password: 'Solar123', url: '', created: '' },
  { project: 'Mugundamani_3 KWp', brand: 'Fronious', username: 'mail@shiroienergy.com', password: 'Shiroienergy@04', url: '', created: '' },
  { project: 'GRN Poes Garden_4 KWp', brand: 'Fronious', username: 'mail@shiroienergy.com', password: 'Shiroienergy@04', url: '', created: '' },
  { project: 'Siddharth_1 KWp', brand: 'Fimer', username: 'Siddharth', password: 'Solar@123', url: '', created: '' },
  { project: 'Sriram_4 KWp', brand: 'Fimer', username: 'Sriramsv', password: 'Solar@123', url: '', created: '' },
  { project: 'Sri Sayee School_16 KWp', brand: 'Growatt', username: 'srisayee', password: 'vivekananda', url: '', created: '' },
  { project: 'Sri Sayee School_1 KWp', brand: 'Growatt', username: 'SSVV', password: 'ssvv2019', url: '', created: '' },
  { project: 'Dhayanada School_7.8 KWp', brand: 'Fimer', username: 'Dayananda', password: 'Solar@123', url: '', created: '' },
  { project: 'Chemfab sricity _110 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },
  { project: 'Chemfab sricity _115 KWp', brand: 'Fimer', username: 'Shiroienergy', password: 'Solar@123', url: '', created: '' },
  { project: 'Edison School _48 KWp', brand: 'Fimer', username: 'Edisonschool', password: 'Generator@123', url: '', created: '' },
  { project: 'Madurai SLCS College_88 KWp', brand: 'Fimer', username: 'slcscollege', password: 'Admin@123', url: '', created: '' },
  { project: 'Chemin Enviro System_45KWp', brand: 'Fimer', username: 'CESZLDS45KW', password: 'Ces@7788', url: '', created: '' },
  { project: 'Chemin Enviro System_2KWp', brand: 'Fimer', username: 'CESZLDS2KW', password: 'Ces@7788', url: '', created: '' },
  { project: 'GGN School _15 KWp', brand: 'Fimer', username: 'Ggnschool', password: 'Solar@123', url: '', created: '' },
  { project: 'Hindu School_50 KWp', brand: 'Fimer', username: 'Hinduschool', password: 'Solar@123', url: '', created: '' },
  { project: 'Solverminds_81 KWp', brand: 'Fimer', username: 'Solverminds', password: 'Solar@123', url: '', created: '' },
  { project: 'Solverminds_8 KWp', brand: 'Goodwee', username: 'infraadmin@solverminds.com', password: 'Solver123', url: '', created: '' },

  // RKM — 3 inverters at one site
  { project: 'RKM1_20 KWp', brand: 'Goodwee', username: 'manivel@shiroienergy.com', password: 'Solar@123', url: '', created: '' },
  { project: 'RKM2_20 KWp', brand: 'Goodwee', username: 'manivel@shiroienergy.com', password: 'Solar@123', url: '', created: '' },
  { project: 'RKM3_5 KWp', brand: 'Goodwee', username: '', password: 'Solar@123', url: '', created: '' },

  { project: 'GVN_Hospital_60KWp', brand: 'Fimer', username: 'Gvnhospital', password: 'Solar@123', url: '', created: '' },

  // Mrinal Mills — 4 inverters at one site
  { project: 'Mrinal_mills_507Kwp_Inverter_1(125Kwp)', brand: 'Goodwee', username: 'mrinalstores_msm@yahoo.com', password: 'Mrinal@123', url: '', created: '' },
  { project: 'Mrinal_mills_507Kwp_Inverter_2(125Kwp)', brand: 'Goodwee', username: 'mrinalstores_msm@yahoo.com', password: 'Mrinal@123', url: '', created: '' },
  { project: 'Mrinal_mills_507Kwp_Inverter_3(125Kwp)', brand: 'Goodwee', username: 'mrinalstores_msm@yahoo.com', password: 'Mrinal@123', url: '', created: '' },
  { project: 'Mrinal_mills_507Kwp_Inverter_4(132Kwp)', brand: 'Goodwee', username: 'mrinalstores_msm@yahoo.com', password: 'Mrinal@123', url: '', created: '' },

  { project: 'RWD Lemongras_20Kwp', brand: 'Goodwee', username: 'Maintenance.lemongraz@gmail.com', password: 'Goodwe2018', url: '', created: '' },
  { project: 'Soori Besant nagar_5Kwp', brand: 'Polycab', username: 'shravan@shiroienergy.com', password: 'Admin123', url: '', created: '' },
  { project: 'Chemittiya_Palakad_5Kwp', brand: 'Growatt', username: 'chemittiya', password: 'Solar@123', url: '', created: '' },
  { project: 'Kumaraguru_5kw', brand: 'Growatt', username: 'Kumarguru', password: 'admin123', url: '', created: '' },
  { project: 'Chandru_5kw', brand: 'Growatt', username: 'Chandru', password: 'admin123', url: '', created: '' },

  // Metal Forms SPK — 2 inverters
  { project: 'Metal forms-SPK110Kw-Inv-1(165Kw)', brand: 'Goodwee', username: 'Mail2@shiroienergy.com', password: 'Solar123', url: '', created: '' },
  { project: 'Metal forms-SPK55Kw-Inv-2(165Kw)', brand: 'Goodwee', username: 'Mail2@shiroienergy.com', password: 'Solar123', url: '', created: '' },

  // Metal Forms Redhills — 3 inverters
  { project: 'Metal forms-Redhills-110Kw-Inv-1(330Kw)', brand: 'Goodwee', username: 'mail2@shiori.com', password: 'Solar123', url: '', created: '' },
  { project: 'Metal forms-Redhills-110Kw-Inv-2(330Kw)', brand: 'Goodwee', username: 'mail2@shiori.com', password: 'Solar123', url: '', created: '' },
  { project: 'Metal forms-Redhills-110Kw-Inv-3(330Kw)', brand: 'Goodwee', username: 'mail2@shiori.com', password: 'Solar123', url: '', created: '' },

  // SVA Syntex — 2 inverters
  { project: 'SVA syntex pvt.ltd-126.5Kw-Inv-1(253Kw)', brand: 'Goodwee', username: 'svafactory@gmail.com', password: 'Goodwe2018', url: '', created: '' },
  { project: 'SVA syntex pvt.ltd-126.5Kw-Inv-2(253Kw)', brand: 'Goodwee', username: 'svafactory@gmail.com', password: 'Goodwe2018', url: '', created: '' },

  // GVG Industries — 3 inverters
  { project: 'GVG Industries pvt.ltd-123Kw-Inv-1(370Kw)', brand: 'Goodwee', username: 'gvgindustries@gmail.com', password: 'Admin@123', url: '', created: '' },
  { project: 'GVG Industries pvt.ltd-123Kw-Inv-2(370Kw)', brand: 'Goodwee', username: 'gvgindustries@gmail.com', password: 'Admin@123', url: '', created: '' },
  { project: 'GVG Industries pvt.ltd-123Kw-Inv-3(370Kw)', brand: 'Goodwee', username: 'gvgindustries@gmail.com', password: 'Admin@123', url: '', created: '' },

  // SVPB Spinners — 2 inverters
  { project: 'SVPB Spinners pvt.ltd-123.2Kw-Inv-1(248Kw)', brand: 'Goodwee', username: 'gvgindustries@gmail.com', password: 'Admin@123', url: '', created: '' },
  { project: 'SVPB Spinners pvt.ltd-125.4Kw-Inv-2(248Kw)', brand: 'Goodwee', username: 'gvgindustries@gmail.com', password: 'Admin@123', url: '', created: '' },

  { project: 'Sri Krishna Sweets-125Kw', brand: 'Goodwee', username: 'tech@srikrishnasweets.net', password: 'Solar@123', url: '', created: '' },
  { project: 'Premier Tiruvanandapuram-27KW', brand: 'Goodwee', username: 'accounts@premieroffice.in', password: 'Solar@123', url: '', created: '' },
  { project: 'Shankar narayanan-Plaza-5Kw', brand: 'Growatt', username: 'gtshankar@gmail.com', password: 'Pass@1234', url: '', created: '' },

  // RKM Mylapore — 2 inverters
  { project: 'RKM-17Kw-(32KW)-Inv-1', brand: 'Growatt', username: 'RKMmylapore', password: 'Solar@123', url: '', created: '' },
  { project: 'RKM-15Kw-(32KW)-Inv-2', brand: 'Growatt', username: 'RKMmylapore', password: 'Solar@123', url: '', created: '' },

  { project: 'Nebu Olympia Panache (8KW)', brand: 'Goodwee', username: 'achayan@gmail.com', password: 'neenu555', url: '', created: '' },
  { project: 'Karthick ECR (9.6KW)', brand: 'Deye', username: 'chrome6boy@gmail.com', password: 'Solar@123', url: '', created: '' },
  { project: 'Suresh Panache (5KW)', brand: 'Deye', username: 'ssuresh2480@gmail.com', password: 'Solar@123', url: '', created: '' },
  { project: 'Praveen (4KW)', brand: 'Deye', username: 'prajugops@gmail.com', password: 'Solar@123', url: '', created: '' },
  { project: 'Praveen (2KW)', brand: 'Deye', username: 'prajugops@gmail.com', password: 'Solar@123', url: '', created: '' },
  { project: 'Ambatore Rotary Hospital (50KW)', brand: 'Growatt', username: 'arhsolar', password: 'Solar123', url: '', created: '' },
  { project: 'Lavanya Shankar (5 KW)', brand: 'Deye', username: 'shravan@shiroienergy.com', password: 'Solar123', url: '', created: '' },
];

// ─────────────────────────────────────────────────────────────────────────
// Classifier
// ─────────────────────────────────────────────────────────────────────────

const BRANDS = [
  'sungrow', 'growatt', 'sma', 'huawei', 'fronius', 'solis',
  'deye', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy', 'other',
] as const;
type Brand = typeof BRANDS[number];

function classify(row: RawRow): Brand {
  const u = row.url.toLowerCase();
  if (u) {
    if (u.includes('solarmanpv') || u.includes('solarman')) return 'deye';
    if (u.includes('isolarcloud')) return 'sungrow';
    if (u.includes('growatt')) return 'growatt';
    if (u.includes('auroravision') || u.includes('fimer')) return 'fimer';
    if (u.includes('polycabmonitoring')) return 'polycab';
    if (u.includes('power-datacenter') || u.includes('flinenergy')) return 'flin_energy';
    if (u.includes('solarweb') || u.includes('fronius')) return 'fronius';
    if (u.includes('havells')) return 'havells';
    if (u.includes('fusionsolar') || u.includes('huawei')) return 'huawei';
    if (u.includes('sma') || u.includes('sunnyportal')) return 'sma';
    if (u.includes('semsportal') || u.includes('goodwe')) return 'goodwe';
  }
  // Brand-column fallback (normalize typos)
  const b = row.brand.toLowerCase().trim();
  if (b === 'sungrow') return 'sungrow';
  if (b === 'growatt') return 'growatt';
  if (b === 'deye') return 'deye';
  if (b === 'goodwe' || b === 'goodwee') return 'goodwe';
  if (b === 'fimer') return 'fimer';
  if (b === 'polycab') return 'polycab';
  if (b === 'havells') return 'havells';
  if (b === 'flin energy' || b === 'flin_energy') return 'flin_energy';
  if (b === 'fronius' || b === 'fronious' || b === 'fronius solar web') return 'fronius';
  if (b === 'sma') return 'sma';
  if (b === 'huawei') return 'huawei';
  if (b === 'solis') return 'solis';
  return 'other';
}

function portalOf(row: RawRow): string {
  const u = row.url.toLowerCase();
  if (u.includes('solarmanpv')) return 'Solarman';
  if (u.includes('isolarcloud')) return 'iSolarCloud';
  if (u.includes('server.growatt')) return 'server.growatt.com';
  if (u.includes('auroravision')) return 'AuroraVision';
  if (u.includes('polycabmonitoring')) return 'Polycab Monitoring';
  if (u.includes('power-datacenter')) return 'Flin power-datacenter';
  if (u.includes('solarweb') || u.includes('fronius')) return 'Fronius Solar Web';
  if (u.includes('havells')) return 'Havells';
  if (u.includes('semsportal')) return 'SEMS Portal';
  if (u.includes('fusionsolar')) return 'FusionSolar';
  return '(no url)';
}

function normLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
function normUser(s: string): string {
  return s.toLowerCase().trim();
}

// Strip inverter-suffix for multi-inverter plant grouping
function stripInverterSuffix(label: string): string {
  return label
    .replace(/_Inverter_\d+\([^)]*\)$/i, '')
    .replace(/-Inv-\d+\([^)]*\)$/i, '')
    .replace(/-Inv-\d+$/i, '')
    .replace(/_Inv-\d+$/i, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Process
// ─────────────────────────────────────────────────────────────────────────

interface ProcessedRow extends RawRow {
  brandFinal: Brand;
  portal: string;
  stripped: string;       // project label with inverter-suffix removed
  dedupeKey: string;      // normLabel(stripped) | brandFinal | normUser(username)
  parsedDate: number;     // YYYY-MM-DD → epoch ms, or NaN
}

const processed: ProcessedRow[] = RAW.map((r) => {
  const brandFinal = classify(r);
  const stripped = stripInverterSuffix(r.project);
  const dedupeKey = `${normLabel(stripped)}|${brandFinal}|${normUser(r.username)}`;
  const parsedDate = r.created ? Date.parse(r.created) : NaN;
  return { ...r, brandFinal, portal: portalOf(r), stripped, dedupeKey, parsedDate };
});

// Inverter count: total non-deduped rows per brand (the ASK from Vivek).
// Each row in the raw list = one inverter at one site, even if multiple
// rows share a portal login (multi-inverter plants).
const inverterCountByBrand = new Map<Brand, number>();
for (const b of BRANDS) inverterCountByBrand.set(b, 0);
for (const r of processed) {
  inverterCountByBrand.set(r.brandFinal, (inverterCountByBrand.get(r.brandFinal) ?? 0) + 1);
}

// Plant count: dedupe by (stripped project label + brand) — this collapses
// multi-inverter plants AND row-level duplicates.
const plantSeen = new Set<string>();
const plantCountByBrand = new Map<Brand, number>();
for (const b of BRANDS) plantCountByBrand.set(b, 0);
for (const r of processed) {
  const key = `${normLabel(r.stripped)}|${r.brandFinal}`;
  if (plantSeen.has(key)) continue;
  plantSeen.add(key);
  plantCountByBrand.set(r.brandFinal, (plantCountByBrand.get(r.brandFinal) ?? 0) + 1);
}

// Credential rows after full dedupe (the count the importer will land):
// (project_label, brand, username) — latest-by-date wins, paste-order fallback.
const dedupeMap = new Map<string, ProcessedRow>();
for (const r of processed) {
  const existing = dedupeMap.get(r.dedupeKey);
  if (!existing) {
    dedupeMap.set(r.dedupeKey, r);
    continue;
  }
  // Both have a date → latest wins
  if (!isNaN(r.parsedDate) && !isNaN(existing.parsedDate)) {
    if (r.parsedDate > existing.parsedDate) dedupeMap.set(r.dedupeKey, r);
    continue;
  }
  // New row has a date, existing doesn't → new wins
  if (!isNaN(r.parsedDate) && isNaN(existing.parsedDate)) {
    dedupeMap.set(r.dedupeKey, r);
    continue;
  }
  // Existing has date, new doesn't → existing wins (already set)
  if (isNaN(r.parsedDate) && !isNaN(existing.parsedDate)) continue;
  // Neither has date → paste-order: later row wins
  dedupeMap.set(r.dedupeKey, r);
}
const dedupedRows = [...dedupeMap.values()];
const credentialRowsByBrand = new Map<Brand, number>();
for (const b of BRANDS) credentialRowsByBrand.set(b, 0);
for (const r of dedupedRows) {
  credentialRowsByBrand.set(r.brandFinal, (credentialRowsByBrand.get(r.brandFinal) ?? 0) + 1);
}

// Cross-tab: brand × portal (so the "Solarman = Deye" reclassification is visible)
const crosstab = new Map<string, number>();
for (const r of processed) {
  const k = `${r.brandFinal} × ${r.portal}`;
  crosstab.set(k, (crosstab.get(k) ?? 0) + 1);
}

// Duplicates dropped (for audit)
const dupGroups = new Map<string, ProcessedRow[]>();
for (const r of processed) {
  const arr = dupGroups.get(r.dedupeKey) ?? [];
  arr.push(r);
  dupGroups.set(r.dedupeKey, arr);
}
const dupesDropped: { kept: ProcessedRow; dropped: ProcessedRow[] }[] = [];
for (const [, arr] of dupGroups) {
  if (arr.length < 2) continue;
  const kept = dedupeMap.get(arr[0]!.dedupeKey)!;
  const dropped = arr.filter((r) => r !== kept);
  dupesDropped.push({ kept, dropped });
}

// ─────────────────────────────────────────────────────────────────────────
// Render Markdown
// ─────────────────────────────────────────────────────────────────────────

const lines: string[] = [];
lines.push('# Plant-monitoring credentials — brand counts (2026-06-05)');
lines.push('');
lines.push('Source: Vivek\'s pasted dump on 2026-06-05.');
lines.push('Classification: portal URL takes precedence; brand column is fallback when URL is blank.');
lines.push('');
lines.push(`**Raw rows pasted:** ${RAW.length}`);
lines.push(`**Distinct plants (after multi-inverter collapse + row-level dedupe):** ${plantSeen.size}`);
lines.push(`**Credentials rows after dedupe (what the importer will create):** ${dedupedRows.length}`);
lines.push(`**Duplicate groups dropped:** ${dupesDropped.length}`);
lines.push('');
lines.push('---');
lines.push('');

lines.push('## Inverter count by brand');
lines.push('');
lines.push('One inverter = one row in the raw paste (multi-inverter plants like Mrinal Mills count as 4).');
lines.push('Use this for inverter-API integration priority.');
lines.push('');
lines.push('| Brand | Inverters | Plants | Cred rows after dedupe |');
lines.push('|---|---:|---:|---:|');
const sortedBrands = [...BRANDS].sort((a, b) =>
  (inverterCountByBrand.get(b) ?? 0) - (inverterCountByBrand.get(a) ?? 0),
);
for (const b of sortedBrands) {
  const inv = inverterCountByBrand.get(b) ?? 0;
  if (inv === 0) continue;
  lines.push(`| ${b} | ${inv} | ${plantCountByBrand.get(b) ?? 0} | ${credentialRowsByBrand.get(b) ?? 0} |`);
}
lines.push('');

lines.push('## Cross-tab: brand × portal');
lines.push('');
lines.push('Confirms the "Solarman is Deye" reclassification — all Solarman rows now land under Deye.');
lines.push('');
lines.push('| Brand × Portal | Inverters |');
lines.push('|---|---:|');
const sortedCross = [...crosstab.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of sortedCross) lines.push(`| ${k} | ${v} |`);
lines.push('');

lines.push('## Duplicates dropped');
lines.push('');
lines.push('Latest-by-Created-date wins; paste-order fallback when no date.');
lines.push('');
for (const { kept, dropped } of dupesDropped) {
  lines.push(`- **KEPT:** ${kept.stripped} | brand=${kept.brandFinal} | user=${kept.username} | pw=${kept.password} | created=${kept.created || '(none)'}`);
  for (const d of dropped) {
    lines.push(`  - dropped: pw=${d.password} | created=${d.created || '(none)'}`);
  }
}
lines.push('');

writeFileSync(
  resolve('scripts/data/credentials-brand-counts-2026-06-05.md'),
  lines.join('\n'),
  'utf8',
);

// ─────────────────────────────────────────────────────────────────────────
// Print summary to stdout
// ─────────────────────────────────────────────────────────────────────────

console.log('Raw rows:', RAW.length);
console.log('Distinct plants:', plantSeen.size);
console.log('Credential rows after dedupe:', dedupedRows.length);
console.log('Duplicate groups dropped:', dupesDropped.length);
console.log('');
console.log('Inverters by brand:');
for (const b of sortedBrands) {
  const inv = inverterCountByBrand.get(b) ?? 0;
  if (inv === 0) continue;
  console.log(`  ${b.padEnd(14)} ${String(inv).padStart(4)} inverters | ${String(plantCountByBrand.get(b) ?? 0).padStart(3)} plants | ${String(credentialRowsByBrand.get(b) ?? 0).padStart(3)} cred rows`);
}
console.log('');
console.log('Wrote scripts/data/credentials-brand-counts-2026-06-05.md');
