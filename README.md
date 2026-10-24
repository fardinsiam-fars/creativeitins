# Film & Media Homework Portal — Cloud Edition

This version keeps the red/black Film & Media look but replaces browser-only storage with a shared Supabase database.

## Features
- Shared lessons, batches, unlock limits, and deadlines across computers.
- Student accounts, tied to a batch code and full name.
- 50-student maximum per batch, enforced in the database.
- A student can submit once per class. Database uniqueness and row-level security prevent changing or deleting a submitted URL.
- Teacher can create batches, unlock classes, manage shared lesson content, assign classes with batch-specific deadlines, and review submissions.
- Deadline countdown in the student class view; the database rejects submissions after the deadline.
- 29 class slots, and the initial batch `PVE 2606`.

## Important before using with real students
You must configure Supabase once. This is necessary: a static ZIP by itself cannot sync data between devices. Supabase has a free tier, subject to its current limits. Hosting is also required for students to access the site online.

## Setup

### 1. Create the Supabase project
1. Go to https://supabase.com and create a project.
2. In **Project Settings → API**, copy the Project URL and anon/public key.
3. Open `js/config.js` and replace `YOUR_SUPABASE_PROJECT_URL` and `YOUR_SUPABASE_ANON_KEY`.
4. Never put a `service_role` key in browser JavaScript.

### 2. Create the database
1. In Supabase, open **SQL Editor → New query**.
2. Paste/run all contents of `supabase/setup.sql`.
3. The script creates tables, access policies, deadline enforcement, one-submission-per-class enforcement, and the 50-student cap.

### 3. Create teacher account
1. Start the website locally or after hosting it.
2. Select **Student account** and create an account using the teacher's intended email/password and batch code `PVE 2606` (you can use a temporary student name).
3. Confirm the email if Supabase asks you to.
4. In Supabase → SQL Editor, run the following, replacing the email:
   `update public.profiles set role='teacher', batch_code=null where email='teacher@example.com';`
5. Sign out and sign back in. That account now opens the teacher workspace.
6. In the teacher workspace, create or edit lessons, unlock classes for batches, and set deadlines.

**Security note:** only promote an account you control to teacher. Do not expose the Supabase service-role key. The website uses the public anon key with database row-level security.

### 4. Student onboarding
1. Create a batch in Teacher Workspace first, or use `PVE 2606`.
2. Students choose **Student account**, enter their email, password, full name, and exact batch code.
3. If email confirmation is enabled, students must confirm their email before signing in.
4. In Supabase → Authentication settings, configure the site URL and redirect URLs for the address where the site is hosted.
5. Each batch has a maximum of 50 student accounts. If a student enters an invalid/inactive batch code, the profile trigger will reject the registration/profile assignment.

### 5. Host the site
For local testing, run a simple local web server from this folder (VS Code Live Server is fine). For students, deploy the whole folder to a static host such as Netlify, Cloudflare Pages, or GitHub Pages. Keep the folder structure:
- `index.html`
- `assets/logo.svg`
- `css/style.css`
- `js/config.js`
- `js/app.js`
- `supabase/setup.sql` (setup reference; not required for browser runtime)

Every computer must open the same hosted URL to share data.

## How deadlines work
Each batch/class deadline is interpreted in the teacher's browser local timezone and saved as a timestamp. Students see a live countdown. The database trigger independently rejects late submissions. If no deadline is set, submissions remain open.

## Submission rule
A student can submit one URL per class. The database has a unique `(lesson_id, student_id)` constraint and deliberately has no update/delete policy for submissions. Check the URL carefully before submitting.

## Existing local data
Your old browser-only data is not automatically migrated into Supabase. Open your old site, export the JSON backup from its Settings & backup section if that data is still available, then manually copy class titles/instructions/resources into the cloud teacher workspace. This starter cloud package does not import the old JSON backup automatically.

## Troubleshooting
- **"Setup needed"**: `js/config.js` still contains placeholder values.
- **Profile not found**: confirm email if required; check Supabase Authentication and the `profiles` table.
- **Batch full**: 50 student accounts are already associated with that batch.
- **Student can't see a class**: check batch active status and `unlocked_through`.
- **Can't create teacher account**: create it as a student first, then promote it using the SQL statement above.
- **Submission rejected**: the class may be locked, deadline may have passed, or that student may already have submitted.

This is a working starter package, but configure and test it with a few dummy accounts before sharing with a full batch.


## Updated features
- **Password recovery:** Students use "Forgot password?" and follow the email link to set a new password. In Supabase → Authentication → URL Configuration, add your local URL and deployed site URL to Redirect URLs. Example local URL: `http://127.0.0.1:5500/**`.
- **Teacher folders:** New batches are grouped under the signed-in teacher. Existing batches with no teacher owner remain in an "Unassigned / existing batches" folder; they can still be managed by a teacher until assigned.
- **Per-batch deadlines:** Create shared lesson content in Homework library, then open Batches → "Assign classes / deadlines" for a batch, tick the classes, set each deadline, and save. The student's list and the database submission check use that batch-specific deadline.
- **50-student capacity:** The SQL trigger now rejects enrollment after 50 students in a batch.

## Updating an existing database
Run the revised `supabase/setup.sql` in the Supabase SQL Editor. It adds the `teacher_id` column and `batch_lessons` table, updates the capacity trigger and policies, and backfills existing batch/class pairs using any existing lesson deadlines. Review/test with dummy accounts before distributing the portal.


## Folder-based batch management update
1. Back up your current project files.
2. In Supabase Dashboard → SQL Editor, run `supabase/folder_migration.sql`. This adds teacher-owned folders and a folder reference on batches without deleting existing batches or submissions.
3. Replace the deployed/local website files with the files in this package, keeping your real Supabase URL and anon key in `js/config.js`.
4. Refresh the site and sign in as a teacher. Create a folder, open it, then create batches inside it. Rename and delete folders you own. Existing batches appear under **Existing / unfiled batches**; choose a folder for each to move it.
5. Test with one folder and one batch first. Existing batch codes remain unchanged and student submissions are not deleted by moving a batch or deleting its folder.

Folder changes were syntax-checked locally, but not tested against your live Supabase project. If SQL Editor reports an error, stop and share the complete error message before proceeding.
