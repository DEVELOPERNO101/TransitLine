# Transitline backend

A real Express + PostgreSQL backend: hashed passwords, JSON Web Token sessions,
persistent bus GPS storage, and per-user alert history — the actual server behind
what the ops-center.html frontend has been simulating in the browser's memory.

## Deploy to Render (free, no credit card)

1. Create a free account at render.com.
2. **New + → PostgreSQL** — create a free database. Copy its "External Database URL"
   once it's ready.
3. Open that database's connection page (or use `psql`/a GUI client like TablePlus)
   and run everything in `schema.sql` against it once, to create the tables.
4. Push this `backend/` folder to a GitHub repo (Render deploys from Git).
5. **New + → Web Service** → connect that repo.
   - Build command: `npm install`
   - Start command: `npm start`
6. Under the web service's **Environment** tab, add:
   - `DATABASE_URL` = the connection string from step 2
   - `JWT_SECRET` = any long random string (a password generator output is fine)
7. Deploy. Render gives you a live URL like `https://transitline-backend.onrender.com`.
8. Visit `https://your-url.onrender.com/api/health` — it should return `{"ok":true}`.
   The free tier sleeps after 15 minutes idle, so the first request after a quiet
   spell takes 30-60 seconds to wake up — that's normal, not a bug.

## API summary

| Method | Path              | Auth        | Purpose                                   |
|--------|-------------------|-------------|--------------------------------------------|
| POST   | /api/signup       | —           | Create an account (admin or driver), sign in |
| POST   | /api/login        | —           | Sign in to an existing account            |
| POST   | /api/drivers      | admin only  | Admin adds a driver account directly       |
| POST   | /api/buses/gps    | any account | Report/update a bus's live GPS position   |
| GET    | /api/buses        | any account | List every bus's current position         |
| GET    | /api/alerts       | any account | The signed-in user's own alert history only |
| GET    | /api/school       | any account | Current school name + location            |
| POST   | /api/school       | admin only  | Update school name + location             |

Every authenticated request needs `Authorization: Bearer <token>`, using the token
returned from `/api/signup` or `/api/login`.

## What's next

The `ops-center.html` frontend still manages all of this in browser memory. The next
step is rewiring it to call this API with `fetch()` instead — swapping the in-memory
`ACCOUNTS`, `busMarkers`, and `ALERTS` objects for real requests to these endpoints.
That's a meaningful rewrite of the frontend's JavaScript, best done once this backend
is actually deployed and its live URL is confirmed working — bring that URL back and
the frontend rewiring is the next piece.
