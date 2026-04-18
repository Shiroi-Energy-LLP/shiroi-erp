-- ============================================================================
-- Migration 078 — Backfill proposal dates from Google Drive folder createdTime
-- ============================================================================
-- Context: migrations 076+077 used FY/CY year from project_number / proposal_number
-- and fell back to the FY or CY start date (e.g. April 1 or January 1). Those
-- synthetic boundary dates clustered hundreds of proposals on fake dates:
--   - 2025-04-01 IST: 174 proposals
--   - 2024-04-01 IST: 115
--   - 2024-01-01 IST: 96
--   - 2023-01-01 IST: 84
--   - 2022-01-01 IST: 48
--   - 2022-04-01 IST: 44
--
-- User (Vivek) flagged this as wrong: "Everything here is 31/3/24 that is the
-- date on which it was uploaded to Hubspot. Hubspot is not right with the dates.
-- Pls go over the google drive properly..."
--
-- We scanned 4 "Proposals YYYY" folders in Google Drive (1,405 children), matched
-- folder names like "PV018/24 Customer Name" to DB proposal_number, and kept
-- 229 unambiguous matches with non-bulk-reorg Drive createdTime.
-- (The 2022 folder was bulk-reorganised on 2023-05-23, so those Drive dates
-- cannot be used — 70 matches filtered out.)
--
-- Safety:
--   - Only updates 229 specific proposal UUIDs (inline list).
--   - Unconditional replacement: Drive createdTime is authoritative.
--   - Timestamps set to 12:00 noon IST for stable display.
--   - Leads get re-cascaded (MIN of linked proposals).

BEGIN;

-- ------------------------------------------------------------------
-- 1. Proposals — created_at ← Drive folder createdTime (unconditional)
-- ------------------------------------------------------------------
WITH drive_dates (proposal_id, new_created_at) AS (VALUES
  ('eb915c85-0965-4b05-b919-e854cf5daa21'::uuid, make_timestamptz(2023, 5, 16, 12, 0, 0, 'Asia/Kolkata')),
  ('6859908f-8280-4431-ad31-11130b6c47c0'::uuid, make_timestamptz(2023, 5, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('78b9c561-3dab-48dd-b3a5-fb81c8e24930'::uuid, make_timestamptz(2023, 5, 6, 12, 0, 0, 'Asia/Kolkata')),
  ('d968b3cb-83d0-4261-a8d6-7792ed958e57'::uuid, make_timestamptz(2023, 5, 9, 12, 0, 0, 'Asia/Kolkata')),
  ('a1db9029-5e10-44dd-9834-d6c5b5adab44'::uuid, make_timestamptz(2023, 5, 12, 12, 0, 0, 'Asia/Kolkata')),
  ('71cfbb1e-456b-4d1a-b19e-3337423c9723'::uuid, make_timestamptz(2023, 6, 1, 12, 0, 0, 'Asia/Kolkata')),
  ('7776b254-cca7-4daf-b33b-5e5c3f92fe01'::uuid, make_timestamptz(2023, 6, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('8ebdda9f-d558-4784-93aa-3cc04b152d28'::uuid, make_timestamptz(2023, 6, 13, 12, 0, 0, 'Asia/Kolkata')),
  ('d7f17fa1-273c-4703-be1f-7831cc3b509d'::uuid, make_timestamptz(2023, 6, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('5387228b-9bb8-403b-958d-cdc6f2266b07'::uuid, make_timestamptz(2023, 6, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('729b573f-7202-4de0-8d44-4fc401e2786b'::uuid, make_timestamptz(2023, 6, 16, 12, 0, 0, 'Asia/Kolkata')),
  ('3cbf6b1a-3892-4d1b-b294-7c93f71a8226'::uuid, make_timestamptz(2023, 6, 17, 12, 0, 0, 'Asia/Kolkata')),
  ('f77d7ba3-04da-49ef-8a69-154dded421ea'::uuid, make_timestamptz(2023, 6, 17, 12, 0, 0, 'Asia/Kolkata')),
  ('f5aa4f6f-04d7-486f-a6d5-b24c8f7059a0'::uuid, make_timestamptz(2023, 6, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('070d1525-f351-4d3b-bd2e-f6d554b40737'::uuid, make_timestamptz(2023, 6, 30, 12, 0, 0, 'Asia/Kolkata')),
  ('f93dc32f-41b2-4b2e-af6d-b9d7c6809f3c'::uuid, make_timestamptz(2023, 7, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('7f6983e0-1213-4ec6-ad34-809e49ae23a6'::uuid, make_timestamptz(2023, 7, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('625fd1ea-6ecd-4e4c-9ed3-d106780cbdf1'::uuid, make_timestamptz(2023, 7, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('37483495-7d01-4ee8-b5b2-011139dca3f9'::uuid, make_timestamptz(2023, 7, 13, 12, 0, 0, 'Asia/Kolkata')),
  ('e1a1db6f-c0ab-4df9-93c7-c9956d3590a2'::uuid, make_timestamptz(2023, 7, 18, 12, 0, 0, 'Asia/Kolkata')),
  ('72364007-c191-46df-9fb7-2a7309e277fa'::uuid, make_timestamptz(2023, 7, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('70224f20-b7b2-492c-b0f9-bdff818b3e72'::uuid, make_timestamptz(2023, 8, 1, 12, 0, 0, 'Asia/Kolkata')),
  ('c01b0325-40e3-43bf-baab-30b6ddf07ee3'::uuid, make_timestamptz(2023, 8, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('85e868fe-d0f7-4fb8-943e-6b5137b5f9b7'::uuid, make_timestamptz(2023, 8, 10, 12, 0, 0, 'Asia/Kolkata')),
  ('f97c7483-37c7-47c2-95ec-ec5223054e2f'::uuid, make_timestamptz(2023, 8, 10, 12, 0, 0, 'Asia/Kolkata')),
  ('90cc09d6-efbb-4d0a-9c0f-1da6b582dea5'::uuid, make_timestamptz(2023, 8, 21, 12, 0, 0, 'Asia/Kolkata')),
  ('cd48111b-549c-49e8-b6d9-f7c16f81cbd0'::uuid, make_timestamptz(2023, 8, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('7df0e6fb-c222-4027-9d5e-e6c18e3b4778'::uuid, make_timestamptz(2023, 8, 29, 12, 0, 0, 'Asia/Kolkata')),
  ('a0c908ae-0695-4492-9979-419f3ea54d75'::uuid, make_timestamptz(2023, 8, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('50b657fe-215c-46f8-97ed-434a9f673c4f'::uuid, make_timestamptz(2023, 8, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('ae346ccc-7ce9-4eb5-aa0a-fe01247241d5'::uuid, make_timestamptz(2023, 9, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('778a5f53-79da-4588-b59e-2d7aa7b7b28f'::uuid, make_timestamptz(2023, 9, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('b1b3b696-7044-4f58-8ef3-5c59140c1941'::uuid, make_timestamptz(2023, 9, 9, 12, 0, 0, 'Asia/Kolkata')),
  ('b530f4c8-7df9-4fc3-95bf-3350e0f49350'::uuid, make_timestamptz(2023, 9, 12, 12, 0, 0, 'Asia/Kolkata')),
  ('22674a1a-71b4-408f-ac7f-7969d6cda587'::uuid, make_timestamptz(2023, 9, 13, 12, 0, 0, 'Asia/Kolkata')),
  ('1cb28e2e-193d-4766-b8eb-185f9e8db32e'::uuid, make_timestamptz(2023, 9, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('96209489-7075-408b-bde5-3496516a91b5'::uuid, make_timestamptz(2023, 9, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('460dfe67-ab9b-4170-8ac0-aff5b7454f91'::uuid, make_timestamptz(2023, 9, 22, 12, 0, 0, 'Asia/Kolkata')),
  ('a7d03d4c-370d-49a2-9481-d01574ff8901'::uuid, make_timestamptz(2023, 9, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('33264d1e-e98f-4348-8366-0522cff27de1'::uuid, make_timestamptz(2023, 9, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('0bcb69ba-1a0d-4940-8ab4-876268e00648'::uuid, make_timestamptz(2023, 9, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('95190f71-b547-42f0-a20c-8baeb00ddccd'::uuid, make_timestamptz(2023, 9, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('5c2d0587-82c6-42ab-ac58-18ab73f7b3a2'::uuid, make_timestamptz(2023, 10, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('f83064bf-e251-4f00-9df6-00bb3af09dc1'::uuid, make_timestamptz(2023, 10, 11, 12, 0, 0, 'Asia/Kolkata')),
  ('0aecd193-8591-4b5d-998a-c995be5f94a6'::uuid, make_timestamptz(2023, 10, 25, 12, 0, 0, 'Asia/Kolkata')),
  ('f12f4620-f2bd-4044-ae30-8155c257407f'::uuid, make_timestamptz(2023, 10, 25, 12, 0, 0, 'Asia/Kolkata')),
  ('9b335143-cc58-4583-9a97-4ab159798537'::uuid, make_timestamptz(2023, 10, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('d362975e-d302-45dd-bb33-ec85da94ab2f'::uuid, make_timestamptz(2023, 11, 14, 12, 0, 0, 'Asia/Kolkata')),
  ('e94fd9f1-8995-4eec-802b-a61e939c7e72'::uuid, make_timestamptz(2023, 12, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('3b7e607b-6be3-4143-82a6-7619f8494774'::uuid, make_timestamptz(2023, 12, 11, 12, 0, 0, 'Asia/Kolkata')),
  ('41b60644-97ba-4be1-90a9-a05588fc6486'::uuid, make_timestamptz(2023, 12, 11, 12, 0, 0, 'Asia/Kolkata')),
  ('82089688-4bb8-4f04-baf6-982818685965'::uuid, make_timestamptz(2023, 12, 11, 12, 0, 0, 'Asia/Kolkata')),
  ('11105f46-d608-4fed-bc42-a75347e13978'::uuid, make_timestamptz(2023, 12, 18, 12, 0, 0, 'Asia/Kolkata')),
  ('46884a5a-d7fc-41eb-8639-d03c0db5d917'::uuid, make_timestamptz(2023, 12, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('f71b7981-5764-4b43-876e-8e2e3b97c7cc'::uuid, make_timestamptz(2023, 12, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('3e26e514-6182-4fba-aae4-4c384dc789b0'::uuid, make_timestamptz(2024, 1, 2, 12, 0, 0, 'Asia/Kolkata')),
  ('1f40458a-22e0-4901-aae0-08138d4f1549'::uuid, make_timestamptz(2024, 1, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('5f91e038-07ad-46db-abb1-5d1f8b4d8c90'::uuid, make_timestamptz(2024, 1, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('de8ba25e-3e3f-42cb-a590-5f653b910e95'::uuid, make_timestamptz(2024, 1, 12, 12, 0, 0, 'Asia/Kolkata')),
  ('413e499b-aa01-4241-892a-bf4bc60bebf0'::uuid, make_timestamptz(2024, 1, 12, 12, 0, 0, 'Asia/Kolkata')),
  ('46407281-6adb-4997-9e05-2a47fc8c4c02'::uuid, make_timestamptz(2024, 1, 17, 12, 0, 0, 'Asia/Kolkata')),
  ('0efcd343-20a7-42c1-8e59-274293a6cfcd'::uuid, make_timestamptz(2024, 1, 18, 12, 0, 0, 'Asia/Kolkata')),
  ('635e6b5f-23ad-4772-ba09-680760c7562b'::uuid, make_timestamptz(2024, 1, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('ddf3d8ae-a82e-4131-98b2-d8870e9d59df'::uuid, make_timestamptz(2024, 1, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('7176764f-829c-4446-b7cf-69961004c077'::uuid, make_timestamptz(2024, 2, 1, 12, 0, 0, 'Asia/Kolkata')),
  ('7543b26a-4854-4dca-8292-0a7ca85fbc56'::uuid, make_timestamptz(2024, 2, 2, 12, 0, 0, 'Asia/Kolkata')),
  ('86e76cd9-245d-4a3a-bcab-bc195e2f94f9'::uuid, make_timestamptz(2024, 2, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('5ad098cd-15f0-4d71-be72-10f5641bbfcf'::uuid, make_timestamptz(2024, 2, 17, 12, 0, 0, 'Asia/Kolkata')),
  ('8fc7cef0-4fbd-4dab-ad37-271b6f1af7ea'::uuid, make_timestamptz(2024, 2, 19, 12, 0, 0, 'Asia/Kolkata')),
  ('0880ed21-d48e-4c75-b512-74c6cecbed39'::uuid, make_timestamptz(2024, 2, 22, 12, 0, 0, 'Asia/Kolkata')),
  ('03855425-a06d-486a-bed5-cfb7854c7dd4'::uuid, make_timestamptz(2024, 2, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('628f9bd6-6483-4d43-92a2-735d8aef9c9a'::uuid, make_timestamptz(2024, 2, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('58dc9ca0-6b9e-4ad9-a8bd-cd01a2de439e'::uuid, make_timestamptz(2024, 3, 2, 12, 0, 0, 'Asia/Kolkata')),
  ('0822f99d-f598-4b78-84cc-eba4ddcef7b1'::uuid, make_timestamptz(2024, 3, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('13aef842-3eb7-4b2e-8642-e9390f92424c'::uuid, make_timestamptz(2024, 3, 6, 12, 0, 0, 'Asia/Kolkata')),
  ('8c00a8e5-987c-465e-ae4c-e123d5ff5dbf'::uuid, make_timestamptz(2024, 3, 11, 12, 0, 0, 'Asia/Kolkata')),
  ('740448a5-dd4d-4a81-a315-83bfcbfb7c0e'::uuid, make_timestamptz(2024, 3, 13, 12, 0, 0, 'Asia/Kolkata')),
  ('2e4965bb-34c1-4567-9b71-240540ee1fc0'::uuid, make_timestamptz(2024, 3, 19, 12, 0, 0, 'Asia/Kolkata')),
  ('d34ac426-354a-4c4f-87fa-cd70ff02f6d6'::uuid, make_timestamptz(2024, 3, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('16c32d67-3571-4b2f-9a28-661c6b6758ec'::uuid, make_timestamptz(2024, 3, 29, 12, 0, 0, 'Asia/Kolkata')),
  ('8b5731f3-f170-4ab6-b66f-f4379fe555cf'::uuid, make_timestamptz(2024, 4, 1, 12, 0, 0, 'Asia/Kolkata')),
  ('ce401df7-0be8-4947-827b-b076401e2f8d'::uuid, make_timestamptz(2024, 4, 2, 12, 0, 0, 'Asia/Kolkata')),
  ('b658402c-1dae-43a6-a6bd-1c5a2cc60132'::uuid, make_timestamptz(2024, 4, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('1ab4307f-392d-421d-acf3-958372e7fbfc'::uuid, make_timestamptz(2024, 4, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('5c79c1c7-1eeb-4ea7-9497-c31f30c55139'::uuid, make_timestamptz(2025, 2, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('11bf17c8-151d-4f13-a23a-5bafb21517a9'::uuid, make_timestamptz(2024, 4, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('49ef0202-ce2a-4f65-b160-65f6a8511c5a'::uuid, make_timestamptz(2024, 4, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('00b2f14e-133d-4348-9f49-a31cd6917fc4'::uuid, make_timestamptz(2024, 4, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('4390393b-7ea8-43d0-ac80-e3125df6bcde'::uuid, make_timestamptz(2024, 4, 6, 12, 0, 0, 'Asia/Kolkata')),
  ('a43d5745-2c2b-463b-8b18-55bceb8ba665'::uuid, make_timestamptz(2024, 4, 11, 12, 0, 0, 'Asia/Kolkata')),
  ('6e722685-7262-4e09-bdb1-bbd5dadb6e4f'::uuid, make_timestamptz(2024, 4, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('aa681e9a-2f19-41f1-a0ea-13481d792a0d'::uuid, make_timestamptz(2024, 4, 19, 12, 0, 0, 'Asia/Kolkata')),
  ('8fb93b37-741a-4f9c-8715-2fa504e8b7af'::uuid, make_timestamptz(2024, 5, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('9edc42a2-9454-4132-8579-aa078d798f59'::uuid, make_timestamptz(2024, 5, 6, 12, 0, 0, 'Asia/Kolkata')),
  ('f95a9c0f-c7f8-4a93-b3a0-9850910dd316'::uuid, make_timestamptz(2024, 5, 14, 12, 0, 0, 'Asia/Kolkata')),
  ('81443a87-de00-4694-81e0-3df7732f4f7a'::uuid, make_timestamptz(2024, 5, 20, 12, 0, 0, 'Asia/Kolkata')),
  ('b36409f5-5ffd-45c6-b5ca-fb84895fab72'::uuid, make_timestamptz(2024, 6, 6, 12, 0, 0, 'Asia/Kolkata')),
  ('b084d447-2fe1-4e34-8b30-586a0e2cfbbd'::uuid, make_timestamptz(2024, 6, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('f7651bdd-7d1e-4d98-8959-f51b01a236ed'::uuid, make_timestamptz(2024, 6, 12, 12, 0, 0, 'Asia/Kolkata')),
  ('ad9bf042-2e8d-4c08-aa68-faf90374ba35'::uuid, make_timestamptz(2024, 6, 17, 12, 0, 0, 'Asia/Kolkata')),
  ('e34993a4-5244-4a46-9b64-97a88acd4be5'::uuid, make_timestamptz(2024, 7, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('0ea383e3-1c6b-49d8-ab14-0f7fa256dc82'::uuid, make_timestamptz(2024, 7, 18, 12, 0, 0, 'Asia/Kolkata')),
  ('509e2cb8-3ab5-4ed8-ae19-161d6fea7b17'::uuid, make_timestamptz(2024, 7, 18, 12, 0, 0, 'Asia/Kolkata')),
  ('fda03c8f-5431-4e21-83ea-ec78c770abbf'::uuid, make_timestamptz(2024, 7, 20, 12, 0, 0, 'Asia/Kolkata')),
  ('d0c37519-96f0-4a03-9da6-a8d107e7f460'::uuid, make_timestamptz(2024, 7, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('84a80cef-f7a0-43aa-b9eb-db3d79c5ba7a'::uuid, make_timestamptz(2024, 7, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('4b0bc909-bc99-4d57-af55-30908506b9de'::uuid, make_timestamptz(2024, 7, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('fcfcab97-85c1-4dcb-aef9-38282f50d98b'::uuid, make_timestamptz(2024, 7, 26, 12, 0, 0, 'Asia/Kolkata')),
  ('f04fc24f-fcff-4189-8956-9e4a9e621c86'::uuid, make_timestamptz(2024, 7, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('d6b2b3c7-fd68-44c2-8ee0-69e15947dbeb'::uuid, make_timestamptz(2024, 7, 29, 12, 0, 0, 'Asia/Kolkata')),
  ('ecf7ef36-e4c6-48a1-9d21-cd156a1412cb'::uuid, make_timestamptz(2024, 8, 2, 12, 0, 0, 'Asia/Kolkata')),
  ('99ca7472-52ce-4ed7-b053-52f1dda98ace'::uuid, make_timestamptz(2024, 8, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('e0c856dc-87ac-46c2-8930-e10fb8cade1e'::uuid, make_timestamptz(2024, 8, 20, 12, 0, 0, 'Asia/Kolkata')),
  ('e36affe9-4c69-46e8-beda-5d0f5916f852'::uuid, make_timestamptz(2024, 8, 13, 12, 0, 0, 'Asia/Kolkata')),
  ('8316fdd3-1a41-46d3-994c-3b2259ed29da'::uuid, make_timestamptz(2024, 8, 20, 12, 0, 0, 'Asia/Kolkata')),
  ('e640c1fb-330b-4849-aa5d-d7233b7b613f'::uuid, make_timestamptz(2024, 8, 22, 12, 0, 0, 'Asia/Kolkata')),
  ('fd09df85-fa43-4eaa-8ffa-f666ecb4b7f3'::uuid, make_timestamptz(2024, 8, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('d9fae5c9-22a9-4f23-87b5-d3c37c787a80'::uuid, make_timestamptz(2024, 9, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('ffd0e3f6-6c15-414a-a72b-c5a01519ce4e'::uuid, make_timestamptz(2024, 9, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('709f924c-78c0-4604-a7ff-5d735462b756'::uuid, make_timestamptz(2024, 9, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('f4fb79c2-addb-475e-bbd2-745489d59854'::uuid, make_timestamptz(2024, 9, 16, 12, 0, 0, 'Asia/Kolkata')),
  ('a1bf3482-bac4-4c77-a7cf-b46e1bf35c54'::uuid, make_timestamptz(2024, 9, 18, 12, 0, 0, 'Asia/Kolkata')),
  ('0fc3c7cd-bcd6-4f50-825d-47228b90a988'::uuid, make_timestamptz(2024, 9, 20, 12, 0, 0, 'Asia/Kolkata')),
  ('80740ab0-a530-4d11-94fa-8fbce2af2843'::uuid, make_timestamptz(2024, 9, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('d57c6628-c12c-4901-9134-79143385613b'::uuid, make_timestamptz(2024, 10, 10, 12, 0, 0, 'Asia/Kolkata')),
  ('328cefd4-a342-4beb-88b9-99d38dd193bd'::uuid, make_timestamptz(2024, 10, 12, 12, 0, 0, 'Asia/Kolkata')),
  ('c8ebebf5-2592-4057-8486-1b32dd008916'::uuid, make_timestamptz(2024, 10, 21, 12, 0, 0, 'Asia/Kolkata')),
  ('fd8ecf2d-6fb1-4c80-8e3c-1e6986880b9a'::uuid, make_timestamptz(2024, 10, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('2a7dfb62-7ffa-4899-8dff-67de1ef30cc7'::uuid, make_timestamptz(2024, 11, 19, 12, 0, 0, 'Asia/Kolkata')),
  ('33562cf0-3c89-4a75-a3a2-306a1f163533'::uuid, make_timestamptz(2024, 11, 19, 12, 0, 0, 'Asia/Kolkata')),
  ('841c4c33-5cf2-488b-a80a-d94702e4a934'::uuid, make_timestamptz(2024, 11, 21, 12, 0, 0, 'Asia/Kolkata')),
  ('283f1843-fa41-494e-a93d-2cb8781967e4'::uuid, make_timestamptz(2024, 11, 25, 12, 0, 0, 'Asia/Kolkata')),
  ('44d11986-216e-4a7a-babd-450196aa0464'::uuid, make_timestamptz(2024, 11, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('85caaf54-691f-4da5-8654-70ee53923ba9'::uuid, make_timestamptz(2025, 1, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('fb4e2f78-0ec2-4ff9-b4cb-5a11a0afe5e9'::uuid, make_timestamptz(2025, 1, 13, 12, 0, 0, 'Asia/Kolkata')),
  ('43c9cbf8-5f00-438c-85aa-4b6309be6033'::uuid, make_timestamptz(2025, 1, 20, 12, 0, 0, 'Asia/Kolkata')),
  ('396b63b8-405b-4078-93b5-351c9321a2f1'::uuid, make_timestamptz(2025, 1, 21, 12, 0, 0, 'Asia/Kolkata')),
  ('81111c7f-9900-4400-ae77-f785474ee3b7'::uuid, make_timestamptz(2025, 1, 30, 12, 0, 0, 'Asia/Kolkata')),
  ('723a7ec5-b69c-47f8-aa6f-0f9c763c4f9d'::uuid, make_timestamptz(2025, 2, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('a14ca769-72ab-4de7-8508-e09e0b357428'::uuid, make_timestamptz(2025, 2, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('b15cd5aa-fd37-4f9e-a9a4-cc590c36c661'::uuid, make_timestamptz(2025, 2, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('80a3a3a5-5e68-4d2a-bc52-ba37c187b1ee'::uuid, make_timestamptz(2025, 2, 14, 12, 0, 0, 'Asia/Kolkata')),
  ('b816aa7d-ba16-4123-b296-9003bec9f8a0'::uuid, make_timestamptz(2025, 2, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('7934777e-7cde-4f16-870f-74fd3147a5f3'::uuid, make_timestamptz(2025, 2, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('6184e822-6a28-451a-84c1-3f2933d3fe32'::uuid, make_timestamptz(2025, 2, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('2d977074-0e6e-4abf-91cd-47f43c44d806'::uuid, make_timestamptz(2025, 3, 11, 12, 0, 0, 'Asia/Kolkata')),
  ('5e69a9b9-b5fc-4a9a-a392-aa56a38fe942'::uuid, make_timestamptz(2025, 3, 19, 12, 0, 0, 'Asia/Kolkata')),
  ('d065fe13-d1d0-44c5-984c-eea1b3c280de'::uuid, make_timestamptz(2025, 3, 21, 12, 0, 0, 'Asia/Kolkata')),
  ('0c224e6b-3e94-4cee-8d8c-ce7bf012aff7'::uuid, make_timestamptz(2025, 3, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('42172e4f-23d2-45f7-b967-b69ead4112f3'::uuid, make_timestamptz(2025, 4, 10, 12, 0, 0, 'Asia/Kolkata')),
  ('749abb00-2a43-41e3-ae15-bc80e0d5f96f'::uuid, make_timestamptz(2025, 4, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('fb9069a8-7be2-4f08-8aa9-2fd1d4e08926'::uuid, make_timestamptz(2025, 4, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('806497f9-b865-4b89-8dd7-1be0a05b3cc1'::uuid, make_timestamptz(2025, 4, 30, 12, 0, 0, 'Asia/Kolkata')),
  ('d2b17b23-c69e-4416-b521-b605d057c610'::uuid, make_timestamptz(2024, 5, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('60ed2c79-b123-4857-b2aa-bf4e67194121'::uuid, make_timestamptz(2024, 5, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('13c075b7-804a-445b-8ca3-e3cfb313b18c'::uuid, make_timestamptz(2024, 5, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('fd63898f-9275-4b71-9e62-0c41ed0f615f'::uuid, make_timestamptz(2024, 5, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('73a10c03-1574-4153-8b85-d2e16f1ea319'::uuid, make_timestamptz(2024, 6, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('c1fdd08a-3c24-4aea-8022-55cf9a9af39e'::uuid, make_timestamptz(2024, 6, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('c7dbf265-74fd-4c96-aa8d-01bb37e837c3'::uuid, make_timestamptz(2024, 6, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('0adb758f-85d2-4cce-890f-9392336561f2'::uuid, make_timestamptz(2024, 6, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('607a1f44-2aea-43e4-bdbe-5ef1e8725ff4'::uuid, make_timestamptz(2024, 6, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('71aece3b-ebc2-4a1d-bfd6-b99f11bed58b'::uuid, make_timestamptz(2024, 6, 21, 12, 0, 0, 'Asia/Kolkata')),
  ('7c8d84c2-47ba-4395-893b-be6fdb638596'::uuid, make_timestamptz(2024, 6, 22, 12, 0, 0, 'Asia/Kolkata')),
  ('7476eb87-d658-4af2-b586-3b04414df6ae'::uuid, make_timestamptz(2024, 7, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('9ecf7c15-ab2b-4e08-b798-78b023a91c29'::uuid, make_timestamptz(2024, 7, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('d5d99d3b-6e08-4b2c-92f5-4ad94b3d3c76'::uuid, make_timestamptz(2024, 7, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('26bdbe45-e2f7-4c8f-a53c-a2d4163403d4'::uuid, make_timestamptz(2024, 7, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('13f2b124-3c35-4aca-ab37-a66336ff5d6d'::uuid, make_timestamptz(2024, 7, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('c26004ed-48b0-4b3b-a68d-72458469acf0'::uuid, make_timestamptz(2024, 7, 9, 12, 0, 0, 'Asia/Kolkata')),
  ('613e6443-ed8b-4d0b-bc20-936ec12f76de'::uuid, make_timestamptz(2024, 7, 11, 12, 0, 0, 'Asia/Kolkata')),
  ('5b23ead1-6fde-41c2-a5b8-9aa9cf9c0086'::uuid, make_timestamptz(2024, 7, 13, 12, 0, 0, 'Asia/Kolkata')),
  ('3e31ec08-9116-4fc5-963c-d5a310183326'::uuid, make_timestamptz(2025, 4, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('b55b0fec-c9e3-42a8-83de-bc4d82d6551b'::uuid, make_timestamptz(2025, 4, 9, 12, 0, 0, 'Asia/Kolkata')),
  ('d4a788ef-f251-422d-9c83-8b1c5dfba0ab'::uuid, make_timestamptz(2025, 4, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('27a8ace5-9afd-4661-92f7-76e003513b7a'::uuid, make_timestamptz(2025, 4, 29, 12, 0, 0, 'Asia/Kolkata')),
  ('668acd5c-4bb3-40f3-b525-dc047773b535'::uuid, make_timestamptz(2025, 5, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('1a36c601-1f7e-4142-b7b5-f815f803a776'::uuid, make_timestamptz(2025, 5, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('1647f8ae-9f85-40bb-adb0-3d04a528989b'::uuid, make_timestamptz(2025, 5, 16, 12, 0, 0, 'Asia/Kolkata')),
  ('b42f7a9c-b6e4-4f6d-9817-4d82b79eafed'::uuid, make_timestamptz(2025, 5, 17, 12, 0, 0, 'Asia/Kolkata')),
  ('8ab3aad1-253f-4173-86a2-5784950e0ff1'::uuid, make_timestamptz(2025, 5, 24, 12, 0, 0, 'Asia/Kolkata')),
  ('40f245b6-75cf-451a-8ff6-07cee418d9c7'::uuid, make_timestamptz(2025, 5, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('99d91135-f1d7-451b-9d6f-fcf0fcc0d61b'::uuid, make_timestamptz(2025, 5, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('09eac2d1-7b5f-4691-9ae6-85e2403be7ff'::uuid, make_timestamptz(2025, 5, 28, 12, 0, 0, 'Asia/Kolkata')),
  ('3ffae996-e589-4f0e-8199-ac03e73279fb'::uuid, make_timestamptz(2025, 6, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('103cc968-e1f7-4f27-ad82-12c096642e29'::uuid, make_timestamptz(2025, 6, 9, 12, 0, 0, 'Asia/Kolkata')),
  ('9307f836-f6ff-4f7e-afc7-b0b48135f433'::uuid, make_timestamptz(2025, 6, 16, 12, 0, 0, 'Asia/Kolkata')),
  ('77f57583-21ac-4e6b-b0af-9d02eee564b6'::uuid, make_timestamptz(2025, 6, 18, 12, 0, 0, 'Asia/Kolkata')),
  ('1b2a27bc-2c9d-4f7e-99b0-8b3318755813'::uuid, make_timestamptz(2025, 6, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('860ec86f-ae87-4e63-bfb5-d65450214d8b'::uuid, make_timestamptz(2025, 6, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('2d5458c4-a70a-4a74-8817-e6d8f584ec9d'::uuid, make_timestamptz(2025, 7, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('60bd1ca8-4e67-43af-bd08-87ce27c17751'::uuid, make_timestamptz(2025, 7, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('4c4076a6-e3eb-4013-b0e0-bb9e2417bf26'::uuid, make_timestamptz(2025, 7, 8, 12, 0, 0, 'Asia/Kolkata')),
  ('aafddac1-27d3-4c81-b577-36ad2f9cbae9'::uuid, make_timestamptz(2025, 7, 9, 12, 0, 0, 'Asia/Kolkata')),
  ('73948363-9e71-4da8-814e-076379b52720'::uuid, make_timestamptz(2025, 7, 15, 12, 0, 0, 'Asia/Kolkata')),
  ('fe1e8f7a-4f54-4f72-8e69-4edc288de6ef'::uuid, make_timestamptz(2025, 7, 16, 12, 0, 0, 'Asia/Kolkata')),
  ('c8c0896f-368b-4acf-a930-3d51ff81f52b'::uuid, make_timestamptz(2025, 7, 17, 12, 0, 0, 'Asia/Kolkata')),
  ('0f10bfcb-345c-42de-a971-47881c38d9c9'::uuid, make_timestamptz(2025, 7, 19, 12, 0, 0, 'Asia/Kolkata')),
  ('630e92d4-13d2-49e8-8eeb-b28c60acf9e6'::uuid, make_timestamptz(2025, 8, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('877d9883-90e1-4abd-b16c-d135a31c56f3'::uuid, make_timestamptz(2025, 8, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('d26fb498-ac75-449c-8f7c-d7fc3775b4ad'::uuid, make_timestamptz(2025, 8, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('fceced30-ac02-4029-8f67-1a86694c695a'::uuid, make_timestamptz(2025, 8, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('7a39ea8e-e86c-47a9-972c-f0d038c07ada'::uuid, make_timestamptz(2025, 8, 9, 12, 0, 0, 'Asia/Kolkata')),
  ('6b902707-2e46-4c9e-b1df-b5e178179c61'::uuid, make_timestamptz(2025, 8, 12, 12, 0, 0, 'Asia/Kolkata')),
  ('af7b721b-236d-46e2-a3dc-aff09870fd9a'::uuid, make_timestamptz(2025, 8, 22, 12, 0, 0, 'Asia/Kolkata')),
  ('ae901b34-62b8-466d-b341-c8097cadd614'::uuid, make_timestamptz(2025, 8, 22, 12, 0, 0, 'Asia/Kolkata')),
  ('c773a2d4-d963-41a2-b464-b9fe4c098644'::uuid, make_timestamptz(2025, 9, 2, 12, 0, 0, 'Asia/Kolkata')),
  ('cd5f7616-4952-41fa-9d05-b1e0f4eecd33'::uuid, make_timestamptz(2025, 9, 10, 12, 0, 0, 'Asia/Kolkata')),
  ('a57c80fb-64c2-4ec4-9290-5df508ef909d'::uuid, make_timestamptz(2025, 10, 6, 12, 0, 0, 'Asia/Kolkata')),
  ('d8925bf1-8ac3-4ffb-a7c0-2b43a8fc8896'::uuid, make_timestamptz(2025, 10, 7, 12, 0, 0, 'Asia/Kolkata')),
  ('38555c73-c5ba-40c9-b51b-b6fac341572b'::uuid, make_timestamptz(2025, 10, 13, 12, 0, 0, 'Asia/Kolkata')),
  ('ecc79fa1-758a-4857-bbd0-2da109f4d1cd'::uuid, make_timestamptz(2025, 10, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('11890e26-16fc-4108-b6bf-5cdb45bac627'::uuid, make_timestamptz(2025, 11, 3, 12, 0, 0, 'Asia/Kolkata')),
  ('5ed6e22d-4d0f-4801-9749-7540f11dd8df'::uuid, make_timestamptz(2025, 11, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('b3601f33-ef4c-4ae6-a21c-15819a49d188'::uuid, make_timestamptz(2025, 11, 5, 12, 0, 0, 'Asia/Kolkata')),
  ('89d17be9-9fe4-463a-bc34-6e77ada744ea'::uuid, make_timestamptz(2025, 11, 12, 12, 0, 0, 'Asia/Kolkata')),
  ('f01d68be-52cf-40a3-ab76-6ecb61ccb3e7'::uuid, make_timestamptz(2025, 11, 22, 12, 0, 0, 'Asia/Kolkata')),
  ('1306d2f0-b133-4c15-88f6-27ba3f6f8489'::uuid, make_timestamptz(2025, 11, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('17db4729-9c6a-43f8-9429-c035ccf323ac'::uuid, make_timestamptz(2025, 12, 18, 12, 0, 0, 'Asia/Kolkata')),
  ('eef111a1-b2a2-42c1-aa9a-32d9a4c15be7'::uuid, make_timestamptz(2025, 12, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('f6f22a98-5d10-4173-9c78-ac7e802c2125'::uuid, make_timestamptz(2026, 1, 21, 12, 0, 0, 'Asia/Kolkata')),
  ('de3da92f-6810-4370-9260-6f9f018b1bd5'::uuid, make_timestamptz(2026, 1, 23, 12, 0, 0, 'Asia/Kolkata')),
  ('29c1da23-3ba2-407f-925e-e7745931c7c8'::uuid, make_timestamptz(2026, 1, 29, 12, 0, 0, 'Asia/Kolkata')),
  ('6cfa47aa-b9ea-422b-9aea-b5286a0cef13'::uuid, make_timestamptz(2026, 1, 31, 12, 0, 0, 'Asia/Kolkata')),
  ('68f4c27d-3e19-4273-8415-7cd72e62d02e'::uuid, make_timestamptz(2026, 2, 4, 12, 0, 0, 'Asia/Kolkata')),
  ('98f48486-7789-4819-84c5-86bb92e9482d'::uuid, make_timestamptz(2026, 2, 14, 12, 0, 0, 'Asia/Kolkata')),
  ('14fcb71e-1000-47b2-b976-4a4e76933b56'::uuid, make_timestamptz(2026, 2, 19, 12, 0, 0, 'Asia/Kolkata')),
  ('8e1878ee-eeee-4e06-97fb-4aa1cbea1338'::uuid, make_timestamptz(2026, 2, 27, 12, 0, 0, 'Asia/Kolkata')),
  ('df310060-7ac7-4b72-9138-0fd98dbdd58c'::uuid, make_timestamptz(2026, 3, 3, 12, 0, 0, 'Asia/Kolkata'))
)
UPDATE proposals pr
SET created_at = dd.new_created_at
FROM drive_dates dd
WHERE dd.proposal_id = pr.id;

-- ------------------------------------------------------------------
-- 2. Leads — re-cascade MIN(linked proposal.created_at)
-- ------------------------------------------------------------------
WITH lead_first_proposal AS (
  SELECT lead_id, MIN(created_at) AS earliest
  FROM proposals
  WHERE lead_id IS NOT NULL
  GROUP BY lead_id
)
UPDATE leads l
SET created_at = lfp.earliest
FROM lead_first_proposal lfp
WHERE lfp.lead_id = l.id
  AND l.created_at > lfp.earliest;

-- ------------------------------------------------------------------
-- 3. Projects — re-cascade from proposal_id FK when present
-- ------------------------------------------------------------------
UPDATE projects p
SET created_at = pr.created_at
FROM proposals pr
WHERE pr.id = p.proposal_id
  AND p.created_at > pr.created_at;

COMMIT;
