# Fuel Bank Logistics App

A mobile-friendly logistics web app built with Next.js, Supabase, and Tailwind CSS for:

- authentication
- driver management
- fuel logging
- bank transfer tracking
- dashboard reporting with filters

## 1. Install dependencies

```bash
npm install
```

## 2. Create environment file

Create `.env.local` in the project root and add:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

## 3. Connect Supabase

1. Create a new Supabase project.
2. Open the SQL Editor in Supabase.
3. Copy everything from `supabase/schema.sql`.
4. Run the SQL to create the tables, triggers, and security policies.
5. In Supabase Auth, enable Email authentication.
6. Copy your project URL and anon key into `.env.local`.

## 4. Run locally

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## 5. App flow

1. Create an account or sign in.
2. Add drivers and vehicle registrations.
3. Save fuel logs and bank transfers.
4. Review totals on the dashboard.

## 6. Edit English and Thai text

- All app copy is stored in `lib/translations.ts`.
- Edit the `en` object for English text.
- Edit the `th` object for Thai text.
- The language toggle state is managed in `lib/language-provider.tsx`.
- The sidebar toggle currently switches the dashboard shell between English and Thai.
