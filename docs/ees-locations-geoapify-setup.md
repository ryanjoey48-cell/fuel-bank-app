# EES Locations Geoapify setup

The Locations lookup uses Geoapify's Forward Geocoding API from the server only. The browser calls `/api/locations/geocode`; it never receives the Geoapify key. The route requires an active EES office user, and the shared database limiter fails closed until its additive migration has been applied.

## Create a free key

1. Create or sign in to a Geoapify account and open **MyProjects**.
2. Create a dedicated project named **EES Locations Directory** and select the **Free** plan. Geoapify currently advertises 3,000 credits per day on Free without a payment card. Keep the project on Free; do not add billing, paid overages, or automatic upgrades.
3. Enable only the Forward Geocoding API for the project if the dashboard offers API-level restrictions.
4. Copy the project's API key into a password manager while configuring each environment. Do not put it in source code, a `NEXT_PUBLIC_*` variable, a browser bundle, SQL, or a ticket.

Geoapify's current plan details are at <https://www.geoapify.com/pricing/> and its Forward Geocoding API parameters are at <https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/>. Recheck the provider dashboard and terms before changing plan or use.

## Configure local development

1. In the repository root, create or edit the ignored `.env.local` file.
2. Add this server-only entry:

   ```dotenv
   GEOAPIFY_API_KEY=your_project_key
   ```

3. Keep the key on the right side of the equals sign only in your local secret file. Do not copy a real value into `.env.example`.
4. Restart `npm run dev` so Next.js loads the variable. The lookup endpoint returns a configuration error until this variable and the rate-limit RPC are both available.

`.env.local` is git-ignored. Check with `git check-ignore -v .env.local` without printing its contents.

## Configure a Vercel preview later

When a preview deployment is approved, add `GEOAPIFY_API_KEY` under the Vercel project's **Settings → Environment Variables** as a Secret scoped to **Preview** and, if possible, only the Locations feature branch. Do not select **Production** for this test. Trigger a new preview build after saving the variable. Never name the variable `NEXT_PUBLIC_GEOAPIFY_API_KEY`.

## Usage guardrails

Each Find on Map action makes at most one Geoapify request. The API has no automatic retry. The additive SQL migration caps application traffic at 2,500 requests per UTC day globally, four requests per second globally, and six requests per user per UTC minute. A cancelled or failed lookup reserves one unit because the provider request may already have started. Do not share this key with other applications; the application cap only accounts for requests made through this EES endpoint.

Candidate coordinates are temporary until a staff member selects a result and confirms saving. The API signs each candidate for the requesting user and destination; the existing map-pin API validates the signature and writes through existing audit controls. Geoapify and OpenStreetMap attribution is shown in the candidate preview and provider attribution metadata is retained with the pin.

The migration at `supabase/migrations/20261020100000_ees_locations_geoapify_rate_limits.sql` is additive and isolated from the historical destination and map-pin tables. Apply it first in a non-production Supabase environment and test there. This task has not applied it to production. Do not enable the production key until the rate-limit migration and preview have been reviewed and separately approved.

Geoapify requires attribution on the Free plan, and OSM attribution is also required. See <https://www.geoapify.com/terms-and-conditions/> and <https://www.openstreetmap.org/copyright>.
