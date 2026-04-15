// /sales/[id] layout - thin re-export of the /leads/[id] layout.
// LeadTabs is URL-space adaptive so the tab bar under /sales correctly
// highlights and links to /sales/[id]/* sub-routes.
export { default } from '../../leads/[id]/layout';
