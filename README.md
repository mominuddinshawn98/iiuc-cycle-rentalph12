# Campus Cycle Rental System

A beginner-friendly university project built with HTML, CSS, Vanilla JavaScript, Node.js, Express.js and MySQL.

## Features

### Student
- Registration and login
- View available bicycles
- Rent with a unique bicycle code
- Return using the same bicycle code
- Automatic pickup and return time
- Automatic rental duration and fee
- Rental history and payment status

### Admin
- One fixed admin account
- Add, edit and delete eligible bicycles
- View bicycle availability
- Dashboard statistics
- Search rental records by student or bicycle code
- Filter rental records by pickup date
- Update cash payment status

## Rental fee rule

The hourly rate is **20 BDT**. Any part of an hour is billed as a full hour.

Examples:
- 20 minutes = 20 BDT
- 1 hour = 20 BDT
- 1 hour 15 minutes = 40 BDT
- 2 hours 5 minutes = 60 BDT

The fee is calculated when the bicycle is returned. Payment is cash only and the admin marks a completed rental as Paid after receiving the cash.

## Requirements

Install:
1. Node.js (LTS version)
2. MySQL Server
3. Visual Studio Code

## Setup

### Step 1: Create the database

Open MySQL Workbench or phpMyAdmin and run the SQL in:

`database/campus_cycle.sql`

This creates the `campus_cycle` database and its four tables.

### Step 2: Configure the project

Open this project folder in VS Code.

Open the terminal in VS Code and run:

```bash
npm install
```

Copy `.env.example` and rename the copy to `.env`.

Edit `.env` and enter your MySQL password if your MySQL account has one.

Example local configuration:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=campus_cycle
SESSION_SECRET=put_a_long_random_secret_here
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
PORT=3000
```

The server creates the fixed admin account automatically the first time it starts, if that username is not already in the admins table.

**Change the default admin password before using this project beyond a local classroom demo.**

### Step 3: Start the project

Make sure MySQL is running. In the VS Code terminal, run:

```bash
npm start
```

Open this address in your browser:

`http://localhost:3000`

Do not open the HTML files directly. Use the local server address above.

## Demo accounts

### Admin
- Username: `admin`
- Password: `admin123`

These are the default values from `.env.example`. If you change them in `.env` before the admin is first created, the new values will be used.

### Student
Register a student account from the website.

## Suggested demonstration

1. Open the home page.
2. Register a student.
3. Log in as admin in another browser or after logging out.
4. Add a bicycle, for example code `CYCLE-001` and name `Campus Bicycle 1`.
5. Log in as the student.
6. Rent `CYCLE-001`.
7. Show that it no longer appears in the available list.
8. Try renting it again to demonstrate the double-rental block.
9. Return it using `CYCLE-001`.
10. Show the duration and fee in rental history.
11. Log in as admin.
12. Find the rental record and change payment status to Paid.

## Important notes

- One student can have only one active bicycle rental at a time.
- A bicycle cannot be rented by two students at the same time. The pickup process uses a MySQL transaction and row lock.
- A bicycle with rental history cannot be deleted, so old rental records remain valid.
- The app uses Express's in-memory session store, which is suitable only for a local university demonstration. A production deployment should use a persistent session store and HTTPS.
- For a real public deployment, add CSRF protection, stronger session configuration, rate limiting, and stricter output handling.

## Project structure

```text
Campus-Cycle-Rental-System/
├── database/
│   └── campus_cycle.sql
├── public/
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── admin-login.html
│   ├── student-dashboard.html
│   ├── admin-dashboard.html
│   ├── style.css
│   ├── login.js
│   ├── register.js
│   ├── admin-login.js
│   ├── student-dashboard.js
│   └── admin-dashboard.js
├── .env.example
├── package.json
├── server.js
└── README.md
```
